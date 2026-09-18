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
  const field_sources: Record<string, string> = {};
  const firstTruthy = <T>(candidates: Array<[T | null | undefined, string]>) => {
    for (const [value, source] of candidates) {
      if (value) return { value, source };
    }
    return { value: null as T | null, source: null };
  };
  const firstPresent = <T>(candidates: Array<[T | null | undefined, string]>) => {
    for (const [value, source] of candidates) {
      if (value !== null && value !== undefined) return { value, source };
    }
    return { value: null as T | null, source: null };
  };
  const apifySource = `apify:${apify?.actor_used ?? "actor"}`;
  const browserTitleSource = `browser:${browser?.selector_debug?.["title"] ?? "page_title"}`;
  const browserSource = (field: string) =>
    `browser:${browser?.selector_debug?.[field] ?? "selector"}`;
  const browserOrRecoverySource = (field: string) =>
    browser?.selector_debug?.[field] === "fb_ai_recovery"
      ? "ai_recovery"
      : browserSource(field);

  const titleResult = firstTruthy([
    [ai?.title, "ai_vision"],
    [apifyOk ? apify.title : null, apifySource],
    [browser?.title, browserTitleSource],
    [metadata?.title, "metadata"],
  ]);
  const title = titleResult.value;
  if (titleResult.source) field_sources["title"] = titleResult.source;

  const priceResult = firstTruthy([
    [ai?.price, "ai_vision"],
    [apifyOk ? apify.price : null, apifySource],
    [browser?.price, browserOrRecoverySource("price")],
  ]);
  const price = priceResult.value;
  if (priceResult.source) field_sources["price"] = priceResult.source;

  const descriptionResult = firstTruthy([
    [ai?.description, "ai_vision"],
    [apifyOk ? apify.description : null, apifySource],
    [browser?.description, browserSource("description")],
    [metadata?.description, "metadata"],
  ]);
  const description = descriptionResult.value;
  if (descriptionResult.source) field_sources["description"] = descriptionResult.source;

  const sellerNameResult = firstTruthy([
    [ai?.seller_name, "ai_vision"],
    [apifyOk ? apify.seller_name : null, apifySource],
    [browser?.seller_name, browserOrRecoverySource("seller_name")],
  ]);
  const seller_name = sellerNameResult.value;
  if (sellerNameResult.source) field_sources["seller_name"] = sellerNameResult.source;

  const sellerProfileUrlResult = firstTruthy([
    [ai?.seller_profile_url, "ai_vision"],
    [apifyOk ? apify.seller_profile_url : null, apifySource],
  ]);
  const seller_profile_url = sellerProfileUrlResult.value;
  if (sellerProfileUrlResult.source) field_sources["seller_profile_url"] = sellerProfileUrlResult.source;

  const sellerMemberSinceResult = firstPresent([
    [apifyOk ? apify.seller_member_since : null, apifySource],
  ]);
  const seller_member_since = sellerMemberSinceResult.value;
  if (sellerMemberSinceResult.source) field_sources["seller_member_since"] = sellerMemberSinceResult.source;

  const sellerReviewCountResult = firstPresent([
    [apifyOk ? apify.seller_review_count : null, apifySource],
  ]);
  const seller_review_count = sellerReviewCountResult.value;
  if (sellerReviewCountResult.source) field_sources["seller_review_count"] = sellerReviewCountResult.source;

  const sellerRatingResult = firstPresent([
    [apifyOk ? apify.seller_rating : null, apifySource],
  ]);
  const seller_rating = sellerRatingResult.value;
  if (sellerRatingResult.source) field_sources["seller_rating"] = sellerRatingResult.source;

  const locationResult = firstTruthy([
    [ai?.location, "ai_vision"],
    [apifyOk ? apify.location : null, apifySource],
    [browser?.location, browserOrRecoverySource("location")],
  ]);
  const location = locationResult.value;
  if (locationResult.source) field_sources["location"] = locationResult.source;

  const conditionResult = firstTruthy([
    [ai?.condition, "ai_vision"],
    [apifyOk ? apify.condition : null, apifySource],
  ]);
  const condition = conditionResult.value;
  if (conditionResult.source) field_sources["condition"] = conditionResult.source;

  const categoryResult = firstTruthy([
    [ai?.category, "ai_vision"],
    [apifyOk ? apify.category : null, apifySource],
  ]);
  const category = categoryResult.value;
  if (categoryResult.source) field_sources["category"] = categoryResult.source;

  const listedDateOrAgeResult = firstTruthy([
    [ai?.listed_date_or_age, "ai_vision"],
    [apifyOk ? apify.listed_date : null, apifySource],
  ]);
  const listed_date_or_age = listedDateOrAgeResult.value;
  if (listedDateOrAgeResult.source) field_sources["listed_date_or_age"] = listedDateOrAgeResult.source;

  const canonical_url = metadata?.canonical_url || browser?.page_url || null;

  // ─── Image merging ───────────────────────────────────────────────────────
  const imageSet = new Set<string>();
  const imageContributions: Array<[string, string]> = [];
  const addImages = (source: string, values: string[]) => {
    for (const image of values) {
      if (!imageSet.has(image)) {
        imageSet.add(image);
        imageContributions.push([source, image]);
      }
    }
  };
  if (metadata?.image) addImages("metadata", [metadata.image]);
  if (browser?.images) addImages("browser", browser.images);
  if (ai?.images_detected) addImages("ai_vision", ai.images_detected);
  // Use Apify images when browser produced none
  const apifyImagesUsed = imageSet.size === 0 && !!apifyOk && apify.images.length > 0;
  if (apifyImagesUsed) {
    addImages(apifySource, apify.images);
  }
  const images = Array.from(imageSet).slice(0, 20);
  const imageSources: string[] = [];
  for (const [source, image] of imageContributions) {
    if (images.includes(image) && !imageSources.includes(source)) imageSources.push(source);
  }
  if (imageSources.length > 0) field_sources["images"] = imageSources.join("+");
  if (aiRecoveryUsed) field_sources["_ai_recovery"] = "fb_ai_recovery";

  const risk_relevant_observations: string[] = ai?.risk_relevant_observations || [];

  // ─── Method attribution ──────────────────────────────────────────────────
  let method_used = "none";
  let method_detail = "none";

  if (apifyOk && (apify.title || apify.price || apify.images.length > 0)) {
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
