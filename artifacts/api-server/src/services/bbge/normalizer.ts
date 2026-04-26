// Normalizer: merges extraction results into the standard BBGE output schema

import { scoreConfidence } from "./confidenceScorer.js";
import type { MetadataResult } from "./metadataExtractor.js";
import type { BrowserResult } from "./browserExtractor.js";
import type { AiVisionResult } from "./aiVisionExtractor.js";

export interface NormalizedListing {
  success: boolean;
  platform: string;
  platform_confidence: number;
  listing_url: string;
  canonical_url: string | null;
  title: string | null;
  price: string | null;
  description: string | null;
  seller_name: string | null;
  seller_profile_url: string | null;
  location: string | null;
  category: string | null;
  condition: string | null;
  listed_date_or_age: string | null;
  images: string[];
  risk_relevant_observations: string[];
  extraction: {
    confidence_score: number;
    method_used: string;
    methods_attempted: string[];
    fields_found: string[];
    fields_missing: string[];
    warnings: string[];
  };
  evidence: {
    screenshot_url: string | null;
    html_excerpt: string | null;
    visible_text_excerpt: string | null;
  };
  raw: {
    metadata: Record<string, unknown>;
    browser: Record<string, unknown>;
    ai: Record<string, unknown>;
  };
}

export function normalize(params: {
  url: string;
  platform: string;
  platform_confidence: number;
  methodsAttempted: string[];
  metadata: MetadataResult | null;
  browser: BrowserResult | null;
  ai: AiVisionResult | null;
  screenshotUrl: string | null;
  warnings: string[];
}): NormalizedListing {
  const { url, platform, platform_confidence, methodsAttempted, metadata, browser, ai, screenshotUrl, warnings } = params;

  // Merge fields from all sources: AI takes priority, then browser, then metadata
  const title =
    ai?.title ||
    metadata?.title ||
    browser?.title ||
    null;

  const price = ai?.price || null;

  const description =
    ai?.description ||
    metadata?.description ||
    null;

  const seller_name = ai?.seller_name || null;
  const seller_profile_url = ai?.seller_profile_url || null;
  const location = ai?.location || null;
  const category = ai?.category || null;
  const condition = ai?.condition || null;
  const listed_date_or_age = ai?.listed_date_or_age || null;

  const canonical_url =
    ai?.seller_profile_url ||
    metadata?.canonical_url ||
    browser?.page_url ||
    null;

  // Merge images
  const imageSet = new Set<string>();
  if (metadata?.image) imageSet.add(metadata.image);
  if (browser?.images) browser.images.forEach((img) => imageSet.add(img));
  if (ai?.images_detected) ai.images_detected.forEach((img) => imageSet.add(img));
  const images = Array.from(imageSet).slice(0, 20);

  const risk_relevant_observations = ai?.risk_relevant_observations || [];

  // Determine primary method used
  let method_used = "none";
  if (ai && !ai.skipped && !ai.error) {
    method_used = "ai_vision";
  } else if (browser && !browser.error) {
    method_used = "rendered_browser";
  } else if (metadata && !metadata.error) {
    method_used = "metadata";
  }

  // Score confidence
  const scored = scoreConfidence(
    { title, price, description, seller_name, location, images },
    platform !== "generic"
  );

  // Collect warnings
  const allWarnings = [...warnings];
  if (ai?.skipped && ai.skip_reason) {
    allWarnings.push(`AI extraction skipped: ${ai.skip_reason}`);
  }
  if (ai?.error) {
    allWarnings.push(`AI extraction error: ${ai.error}`);
  }
  if (browser?.error) {
    allWarnings.push(`Browser extraction error: ${browser.error}`);
  }
  if (metadata?.error) {
    allWarnings.push(`Metadata extraction error: ${metadata.error}`);
  }
  if (scored.confidence_score < 40) {
    allWarnings.push(
      "Extraction confidence is low. In the next phase, BBGE will allow guided screenshot upload or mobile share-sheet capture to fill missing fields."
    );
  }

  return {
    success: true,
    platform,
    platform_confidence,
    listing_url: url,
    canonical_url,
    title,
    price,
    description,
    seller_name,
    seller_profile_url,
    location,
    category,
    condition,
    listed_date_or_age,
    images,
    risk_relevant_observations,
    extraction: {
      confidence_score: scored.confidence_score,
      method_used,
      methods_attempted: methodsAttempted,
      fields_found: scored.fields_found,
      fields_missing: scored.fields_missing,
      warnings: allWarnings,
    },
    evidence: {
      screenshot_url: screenshotUrl,
      html_excerpt: metadata?.raw_html_excerpt || null,
      visible_text_excerpt: browser?.visible_text
        ? browser.visible_text.slice(0, 2000)
        : null,
    },
    raw: {
      metadata: metadata ? (metadata as unknown as Record<string, unknown>) : {},
      browser: browser ? (browser as unknown as Record<string, unknown>) : {},
      ai: ai ? (ai as unknown as Record<string, unknown>) : {},
    },
  };
}
