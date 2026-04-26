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
    field_sources: Record<string, string>;
    is_blocked: boolean;
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

/** Track which extraction layer provided each field */
function buildFieldSources(params: {
  title: string | null;
  price: string | null;
  description: string | null;
  seller_name: string | null;
  location: string | null;
  ai: AiVisionResult | null;
  browser: BrowserResult | null;
  metadata: MetadataResult | null;
}): Record<string, string> {
  const { title, price, description, seller_name, location, ai, browser, metadata } = params;
  const sources: Record<string, string> = {};

  if (title) {
    if (ai?.title) sources["title"] = "ai_vision";
    else if (browser?.title) sources["title"] = `browser:${browser.selector_debug?.["title"] ?? "page_title"}`;
    else if (metadata?.title) sources["title"] = "metadata";
  }
  if (price) {
    if (ai?.price) sources["price"] = "ai_vision";
    else if (browser?.price) sources["price"] = `browser:${browser.selector_debug?.["price"] ?? "selector"}`;
  }
  if (description) {
    if (ai?.description) sources["description"] = "ai_vision";
    else if (browser?.description) sources["description"] = `browser:${browser.selector_debug?.["description"] ?? "selector"}`;
    else if (metadata?.description) sources["description"] = "metadata";
  }
  if (seller_name) {
    if (ai?.seller_name) sources["seller_name"] = "ai_vision";
    else if (browser?.seller_name) sources["seller_name"] = `browser:${browser.selector_debug?.["seller_name"] ?? "selector"}`;
  }
  if (location) {
    if (ai?.location) sources["location"] = "ai_vision";
    else if (browser?.location) sources["location"] = `browser:${browser.selector_debug?.["location"] ?? "selector"}`;
  }

  return sources;
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

  const is_blocked = browser?.is_blocked ?? false;
  const retry_succeeded = browser?.retry_succeeded ?? false;

  // Merge fields: AI → browser selector → metadata
  const title = ai?.title || browser?.title || metadata?.title || null;
  const price = ai?.price || browser?.price || null;
  const description = ai?.description || browser?.description || metadata?.description || null;
  const seller_name = ai?.seller_name || browser?.seller_name || null;
  const location = ai?.location || browser?.location || null;

  const seller_profile_url = ai?.seller_profile_url || null;
  const category = ai?.category || null;
  const condition = ai?.condition || null;
  const listed_date_or_age = ai?.listed_date_or_age || null;

  const canonical_url = metadata?.canonical_url || browser?.page_url || null;

  // Merge images
  const imageSet = new Set<string>();
  if (metadata?.image) imageSet.add(metadata.image);
  if (browser?.images) browser.images.forEach((img) => imageSet.add(img));
  if (ai?.images_detected) ai.images_detected.forEach((img) => imageSet.add(img));
  const images = Array.from(imageSet).slice(0, 20);

  const risk_relevant_observations = ai?.risk_relevant_observations || [];

  // Method used
  let method_used = "none";
  let method_detail = "none";
  if (ai && !ai.skipped && !ai.error) {
    method_used = "ai_vision";
    method_detail = "ai_vision";
  } else if (browser && !browser.error) {
    method_used = "rendered_browser";
    const sel = browser.platform_selector_used || "generic";
    method_detail = `rendered_browser + ${sel}_selector`;
  } else if (metadata && !metadata.error) {
    method_used = "metadata";
    method_detail = "metadata";
  }

  // Confidence scoring
  const scored = scoreConfidence(
    { title, price, description, seller_name, location, images },
    platform !== "generic",
  );

  // Cap confidence when blocked:
  //   - blocked + retry not yet tried or retry also blocked → max 20
  //   - but if retry succeeded, no cap
  //   - AI vision success overrides any cap
  const aiSucceeded = ai && !ai.skipped && !ai.error;
  const rawScore = scored.confidence_score;
  let confidence_score = rawScore;
  if (is_blocked && !aiSucceeded) {
    // retry_succeeded=false means either retry wasn't tried or it also failed
    confidence_score = retry_succeeded ? rawScore : Math.min(20, rawScore);
  }

  // Warnings
  const allWarnings = [...warnings];

  if (is_blocked && !retry_succeeded) {
    allWarnings.push(
      "This marketplace is challenging automated access. BBGE attempted alternate retrieval methods but the page may still be gated. Extraction may be incomplete.",
    );
  } else if (is_blocked && retry_succeeded) {
    allWarnings.push(
      "Initial request was blocked — alternate retrieval succeeded. Some fields may still be missing.",
    );
  }

  if (confidence_score < 40) {
    allWarnings.push(
      "Extraction confidence is low. In the next phase, BBGE will allow guided screenshot upload or mobile share-sheet capture to fill missing fields.",
    );
  }

  const seen = new Set<string>();
  const dedupedWarnings = allWarnings.filter((w) => {
    if (seen.has(w)) return false;
    seen.add(w);
    return true;
  });

  // Field sources attribution
  const field_sources = buildFieldSources({ title, price, description, seller_name, location, ai, browser: browser ?? null, metadata: metadata ?? null });

  // Selector debug
  const selectorDebug: Record<string, string> = { ...(browser?.selector_debug ?? {}) };

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
      confidence_score,
      method_used,
      method_detail,
      methods_attempted: methodsAttempted,
      fields_found: scored.fields_found,
      fields_missing: scored.fields_missing,
      warnings: dedupedWarnings,
      selector_debug: selectorDebug,
      field_sources,
      is_blocked,
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
