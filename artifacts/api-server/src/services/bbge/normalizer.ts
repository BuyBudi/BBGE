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
    method_detail: string;
    methods_attempted: string[];
    fields_found: string[];
    fields_missing: string[];
    warnings: string[];
    selector_debug: Record<string, string>;
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

  // Merge fields: AI takes priority, then browser (structured), then metadata
  const title =
    ai?.title ||
    browser?.title ||
    metadata?.title ||
    null;

  // Price — AI first, then browser selector (new structured field)
  const price =
    ai?.price ||
    browser?.price ||
    null;

  // Description — AI first, then browser selector, then metadata
  const description =
    ai?.description ||
    browser?.description ||
    metadata?.description ||
    null;

  // Seller — AI first, then browser selector
  const seller_name =
    ai?.seller_name ||
    browser?.seller_name ||
    null;

  const seller_profile_url = ai?.seller_profile_url || null;
  const location = ai?.location || null;
  const category = ai?.category || null;
  const condition = ai?.condition || null;
  const listed_date_or_age = ai?.listed_date_or_age || null;

  const canonical_url =
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
  let method_detail = "none";
  if (ai && !ai.skipped && !ai.error) {
    method_used = "ai_vision";
    method_detail = "ai_vision";
  } else if (browser && !browser.error) {
    method_used = "rendered_browser";
    const selectorUsed = browser.platform_selector_used || "generic";
    method_detail = `rendered_browser + ${selectorUsed}_selector`;
  } else if (metadata && !metadata.error) {
    method_used = "metadata";
    method_detail = "metadata";
  }

  // Score confidence
  const scored = scoreConfidence(
    { title, price, description, seller_name, location, images },
    platform !== "generic",
  );

  // Collect warnings — pipeline warnings are already included; only add novel ones here
  const allWarnings = [...warnings];
  if (scored.confidence_score < 40) {
    allWarnings.push(
      "Extraction confidence is low. In the next phase, BBGE will allow guided screenshot upload or mobile share-sheet capture to fill missing fields.",
    );
  }

  // Deduplicate warnings (preserve order)
  const seen = new Set<string>();
  const dedupedWarnings = allWarnings.filter((w) => {
    if (seen.has(w)) return false;
    seen.add(w);
    return true;
  });

  // Merge selector debug from browser
  const selectorDebug: Record<string, string> = {
    ...(browser?.selector_debug ?? {}),
  };

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
      method_detail,
      methods_attempted: methodsAttempted,
      fields_found: scored.fields_found,
      fields_missing: scored.fields_missing,
      warnings: dedupedWarnings,
      selector_debug: selectorDebug,
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
