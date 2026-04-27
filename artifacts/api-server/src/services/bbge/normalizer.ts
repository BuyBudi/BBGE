// Normalizer: merges extraction results into the standard BBGE output schema

import { scoreConfidence } from "./confidenceScorer.js";
import type { MetadataResult } from "./metadataExtractor.js";
import type { BrowserResult } from "./browserExtractor.js";
import type { AiVisionResult } from "./aiVisionExtractor.js";
import type { ApifyExtractorResult } from "./apifyExtractor.js";

export interface NormalizedListing {
  success: boolean;
  status?: string;
  platform: string;
  platform_confidence: number;
  listing_url: string;
  canonical_url: string | null;
  title: string | null;
  price: string | null;
  description: string | null;
  seller_name: string | null;
  seller_profile_url: string | null;
  seller_member_since: string | null;
  seller_review_count: number | null;
  seller_rating: number | null;
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
    ai_recovery_used: boolean;
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
    apify: Record<string, unknown>;
    login_wall?: Record<string, unknown>;
  };
}

// ─── Field source attribution ────────────────────────────────────────────────

function buildFieldSources(params: {
  title: string | null;
  price: string | null;
  description: string | null;
  seller_name: string | null;
  location: string | null;
  ai: AiVisionResult | null | undefined;
  apify: ApifyExtractorResult | null | undefined;
  browser: BrowserResult | null;
  metadata: MetadataResult | null;
  aiRecoveryUsed: boolean;
}): Record<string, string> {
  const { title, price, description, seller_name, location, ai, apify, browser, metadata, aiRecoveryUsed } = params;
  const sources: Record<string, string> = {};

  if (title) {
    if (ai?.title) sources["title"] = "ai_vision";
    else if (apify?.title) sources["title"] = `apify:${apify.actor_used ?? "actor"}`;
    else if (browser?.title) sources["title"] = `browser:${browser.selector_debug?.["title"] ?? "page_title"}`;
    else if (metadata?.title) sources["title"] = "metadata";
  }
  if (price) {
    if (ai?.price) sources["price"] = "ai_vision";
    else if (apify?.price) sources["price"] = `apify:${apify.actor_used ?? "actor"}`;
    else if (browser?.selector_debug?.["price"] === "fb_ai_recovery") sources["price"] = "ai_recovery";
    else if (browser?.price) sources["price"] = `browser:${browser.selector_debug?.["price"] ?? "selector"}`;
  }
  if (description) {
    if (ai?.description) sources["description"] = "ai_vision";
    else if (apify?.description) sources["description"] = `apify:${apify.actor_used ?? "actor"}`;
    else if (browser?.description) sources["description"] = `browser:${browser.selector_debug?.["description"] ?? "selector"}`;
    else if (metadata?.description) sources["description"] = "metadata";
  }
  if (seller_name) {
    if (ai?.seller_name) sources["seller_name"] = "ai_vision";
    else if (apify?.seller_name) sources["seller_name"] = `apify:${apify.actor_used ?? "actor"}`;
    else if (browser?.selector_debug?.["seller_name"] === "fb_ai_recovery") sources["seller_name"] = "ai_recovery";
    else if (browser?.seller_name) sources["seller_name"] = `browser:${browser.selector_debug?.["seller_name"] ?? "selector"}`;
  }
  if (location) {
    if (ai?.location) sources["location"] = "ai_vision";
    else if (apify?.location) sources["location"] = `apify:${apify.actor_used ?? "actor"}`;
    else if (browser?.selector_debug?.["location"] === "fb_ai_recovery") sources["location"] = "ai_recovery";
    else if (browser?.location) sources["location"] = `browser:${browser.selector_debug?.["location"] ?? "selector"}`;
  }
  if (aiRecoveryUsed) sources["_ai_recovery"] = "fb_ai_recovery";
  return sources;
}

// ─── Main normalize function ─────────────────────────────────────────────────

export interface NormalizeInput {
  url: string;
  platform: string;
  platform_confidence: number;
  methodsAttempted: string[];
  metadata: MetadataResult | null;
  browser: BrowserResult | null;
  ai: AiVisionResult | null;
  apify?: ApifyExtractorResult | null;
  screenshotUrl: string | null;
  warnings: string[];
  aiRecoveryUsed?: boolean;
}

export function normalize(params: NormalizeInput): NormalizedListing {
  const {
    url,
    platform,
    platform_confidence,
    methodsAttempted,
    metadata,
    browser,
    ai,
    apify,
    screenshotUrl,
    warnings,
    aiRecoveryUsed = false,
  } = params;

  const is_blocked = browser?.is_blocked ?? false;
  const retry_succeeded = (browser as BrowserResult & { retry_succeeded?: boolean })?.retry_succeeded ?? false;

  // Apify wins over browser/metadata for most fields when not skipped and has data.
  const apifyOk = apify && !apify.skipped && !apify.error;

  // ─── Field merging ───────────────────────────────────────────────────────
  const title =
    ai?.title ||
    (apifyOk ? apify.title : null) ||
    browser?.title ||
    metadata?.title ||
    null;

  const price =
    ai?.price ||
    (apifyOk ? apify.price : null) ||
    browser?.price ||
    null;

  const description =
    ai?.description ||
    (apifyOk ? apify.description : null) ||
    browser?.description ||
    metadata?.description ||
    null;

  const seller_name =
    ai?.seller_name ||
    (apifyOk ? apify.seller_name : null) ||
    browser?.seller_name ||
    null;

  const seller_profile_url =
    ai?.seller_profile_url ||
    (apifyOk ? apify.seller_profile_url : null) ||
    null;

  // Apify-only seller enrichment fields
  const seller_member_since = (apifyOk ? apify.seller_member_since : null) ?? null;
  const seller_review_count = (apifyOk ? apify.seller_review_count : null) ?? null;
  const seller_rating = (apifyOk ? apify.seller_rating : null) ?? null;

  const location =
    ai?.location ||
    (apifyOk ? apify.location : null) ||
    browser?.location ||
    null;

  const condition =
    ai?.condition ||
    (apifyOk ? apify.condition : null) ||
    null;

  const category =
    ai?.category ||
    (apifyOk ? apify.category : null) ||
    null;

  const listed_date_or_age =
    ai?.listed_date_or_age ||
    (apifyOk ? apify.listed_date : null) ||
    null;

  const canonical_url = metadata?.canonical_url || browser?.page_url || null;

  // ─── Image merging ───────────────────────────────────────────────────────
  const imageSet = new Set<string>();
  if (metadata?.image) imageSet.add(metadata.image);
  if (browser?.images) browser.images.forEach((img) => imageSet.add(img));
  if (ai?.images_detected) ai.images_detected.forEach((img) => imageSet.add(img));
  // Use Apify images when browser produced none
  if (imageSet.size === 0 && apifyOk && apify.images.length > 0) {
    apify.images.forEach((img) => imageSet.add(img));
  }
  const images = Array.from(imageSet).slice(0, 20);

  const risk_relevant_observations: string[] = ai?.risk_relevant_observations || [];

  // ─── Method attribution ──────────────────────────────────────────────────
  let method_used = "none";
  let method_detail = "none";

  if (apifyOk && apify.title) {
    method_used = "apify";
    method_detail = apify.actor_used ?? "apify";
  } else if (ai && !ai.skipped && !ai.error) {
    method_used = "ai_vision";
    method_detail = aiRecoveryUsed ? "ai_vision + fb_ai_recovery" : "ai_vision";
  } else if (browser && !browser.error) {
    method_used = "rendered_browser";
    const sel = (browser as BrowserResult & { platform_selector_used?: string }).platform_selector_used || "generic";
    method_detail = aiRecoveryUsed
      ? `rendered_browser + ${sel}_selector + fb_ai_recovery`
      : `rendered_browser + ${sel}_selector`;
  } else if (metadata && !metadata.error) {
    method_used = "metadata";
    method_detail = "metadata";
  }

  // ─── Confidence scoring ──────────────────────────────────────────────────
  const scored = scoreConfidence(
    { title, price, description, seller_name, location, images },
    platform !== "generic",
  );

  const aiSucceeded = ai && !ai.skipped && !ai.error;
  let confidence_score = scored.confidence_score;

  if (is_blocked && !aiSucceeded && !apifyOk) {
    confidence_score = retry_succeeded ? confidence_score : Math.min(20, confidence_score);
  }
  if (platform === "facebook_marketplace" && !price && !seller_name && !aiSucceeded && !apifyOk) {
    confidence_score = Math.min(55, confidence_score);
  }

  // ─── Warnings ────────────────────────────────────────────────────────────
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

  // ─── Field sources ───────────────────────────────────────────────────────
  const field_sources = buildFieldSources({
    title, price, description, seller_name, location,
    ai, apify: apify ?? null, browser: browser ?? null,
    metadata: metadata ?? null, aiRecoveryUsed,
  });

  const selectorDebug: Record<string, string> = { ...browser?.selector_debug ?? {} };

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
    seller_member_since,
    seller_review_count,
    seller_rating,
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
      ai_recovery_used: aiRecoveryUsed,
    },
    evidence: {
      screenshot_url: screenshotUrl,
      html_excerpt: metadata?.raw_html_excerpt || null,
      visible_text_excerpt: browser?.visible_text ? browser.visible_text.slice(0, 2000) : null,
    },
    raw: {
      metadata: metadata ? (metadata as unknown as Record<string, unknown>) : {},
      browser: browser ? (browser as unknown as Record<string, unknown>) : {},
      ai: ai ? (ai as unknown as Record<string, unknown>) : {},
      apify: apify ? (apify as unknown as Record<string, unknown>) : {},
    },
  };
}
