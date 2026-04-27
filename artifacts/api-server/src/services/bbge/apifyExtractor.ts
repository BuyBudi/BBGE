// Apify-based extraction strategy for BBGE
// Slots into the extraction pipeline as method "apify".
// Returns a skipped:true result if APIFY_API_TOKEN is not configured,
// or if there is no known actor for the given platform.

import { logger } from "../../lib/logger.js";

export interface ApifyExtractorResult {
  title: string | null;
  price: string | null;
  description: string | null;
  seller_name: string | null;
  seller_profile_url: string | null;
  seller_member_since: string | null;
  seller_review_count: number | null;
  seller_rating: number | null;
  location: string | null;
  condition: string | null;
  category: string | null;
  listed_date: string | null;
  images: string[];
  attributes: Record<string, string>;
  raw: Record<string, unknown>;
  skipped: boolean;
  error: string | null;
  actor_used: string | null;
}

// Known Apify actors per platform.
// eBay is intentionally absent — it already works via its own selectors.
export const PLATFORM_ACTORS: Record<string, string> = {
  facebook_marketplace: "apify/facebook-marketplace-scraper",
  gumtree: "epctex/gumtree-scraper",
  depop: "barnett/depop-scraper",
  craigslist: "apify/craigslist-scraper",
};

export function isApifyConfigured(): boolean {
  return !!process.env.APIFY_API_TOKEN;
}

function skippedResult(reason?: string): ApifyExtractorResult {
  return {
    title: null,
    price: null,
    description: null,
    seller_name: null,
    seller_profile_url: null,
    seller_member_since: null,
    seller_review_count: null,
    seller_rating: null,
    location: null,
    condition: null,
    category: null,
    listed_date: null,
    images: [],
    attributes: {},
    raw: {},
    skipped: true,
    error: reason ?? null,
    actor_used: null,
  };
}

function errorResult(actorId: string | null, message: string): ApifyExtractorResult {
  return {
    title: null,
    price: null,
    description: null,
    seller_name: null,
    seller_profile_url: null,
    seller_member_since: null,
    seller_review_count: null,
    seller_rating: null,
    location: null,
    condition: null,
    category: null,
    listed_date: null,
    images: [],
    attributes: {},
    raw: {},
    skipped: false,
    error: message,
    actor_used: actorId,
  };
}

function toStringOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function toNumberOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function normaliseItem(item: Record<string, unknown>, actorId: string): ApifyExtractorResult {
  const title = toStringOrNull(
    item.title ?? item.name ?? item.heading,
  );
  const price = toStringOrNull(
    item.price ?? item.priceText ?? item.price_text,
  );
  const description = toStringOrNull(
    item.description ?? item.body ?? item.details,
  );

  const sellerRaw = (item.seller ?? {}) as Record<string, unknown>;
  const seller_name = toStringOrNull(
    item.sellerName ?? item.seller_name ?? sellerRaw.name,
  );
  const seller_profile_url = toStringOrNull(
    item.sellerUrl ?? sellerRaw.profileUrl,
  );
  const seller_member_since = toStringOrNull(
    item.memberSince ?? sellerRaw.memberSince,
  );
  const seller_review_count = toNumberOrNull(
    item.reviewCount ?? sellerRaw.reviewCount,
  );
  const seller_rating = toNumberOrNull(
    item.rating ?? sellerRaw.rating,
  );

  const location = toStringOrNull(
    item.location ?? item.locationText ?? item.city,
  );
  const condition = toStringOrNull(
    item.condition ?? item.itemCondition,
  );
  const category = toStringOrNull(
    item.category ?? item.breadcrumb,
  );
  const listed_date = toStringOrNull(
    item.listedAt ?? item.postedAt ?? item.date,
  );

  const rawImages = item.images ?? item.imageUrls ?? item.photos;
  const images: string[] = Array.isArray(rawImages)
    ? (rawImages as unknown[]).map((i) => String(i)).filter((s) => s.startsWith("http"))
    : [];

  const rawAttrs = item.attributes ?? item.specs ?? item.details_table ?? {};
  const attributes: Record<string, string> =
    rawAttrs && typeof rawAttrs === "object" && !Array.isArray(rawAttrs)
      ? Object.fromEntries(
          Object.entries(rawAttrs as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
        )
      : {};

  return {
    title,
    price,
    description,
    seller_name,
    seller_profile_url,
    seller_member_since,
    seller_review_count,
    seller_rating,
    location,
    condition,
    category,
    listed_date,
    images,
    attributes,
    raw: item,
    skipped: false,
    error: null,
    actor_used: actorId,
  };
}

export async function extractWithApify(
  url: string,
  platform: string,
): Promise<ApifyExtractorResult> {
  if (!isApifyConfigured()) {
    logger.info({ platform }, "Apify skipped: APIFY_API_TOKEN not configured");
    return skippedResult("APIFY_API_TOKEN not configured");
  }

  const actorId = PLATFORM_ACTORS[platform] ?? null;
  if (!actorId) {
    logger.info({ platform }, "Apify skipped: no known actor for this platform");
    return skippedResult(`No Apify actor configured for platform: ${platform}`);
  }

  logger.info({ url, platform, actorId }, "Starting Apify extraction");

  try {
    const { ApifyClient } = await import("apify-client");
    const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN! });

    const run = await client.actor(actorId).call(
      { startUrls: [{ url }], maxItems: 1 },
      { waitSecs: 90 },
    );

    if (!run || !run.defaultDatasetId) {
      return errorResult(actorId, "Apify run did not produce a dataset");
    }

    const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 1 });

    if (!items || items.length === 0) {
      return errorResult(actorId, "Apify dataset returned no items");
    }

    const item = items[0] as Record<string, unknown>;
    const result = normaliseItem(item, actorId);

    logger.info(
      { url, platform, actorId, title: result.title, price: result.price },
      "Apify extraction complete",
    );

    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ url, platform, actorId, error: msg }, "Apify extraction failed");
    return errorResult(actorId, msg);
  }
}
