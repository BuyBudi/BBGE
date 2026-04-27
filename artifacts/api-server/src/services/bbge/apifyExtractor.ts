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
// gumtree_fallback is tried if the primary gumtree actor returns empty results.
export const PLATFORM_ACTORS: Record<string, string> = {
  facebook_marketplace: "apify/facebook-marketplace-scraper",
  gumtree: "crawlerbros/gumtree-scraper",
  gumtree_fallback: "memo23/gumtree-cheerio",
  depop: "barnett/depop-scraper",
  craigslist: "apify/craigslist-scraper",
};

export function isApifyConfigured(): boolean {
  return !!process.env["APIFY_API_TOKEN"];
}

// ─── Empty / error result helpers ────────────────────────────────────────────

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

// ─── Primitive coercers ───────────────────────────────────────────────────────

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

// ─── Actor input builder ──────────────────────────────────────────────────────
// Each actor may expect different input field names.

function buildActorInput(actorId: string, url: string): Record<string, unknown> {
  if (actorId === "crawlerbros/gumtree-scraper") {
    return { startUrls: [{ url }], includeListingDetails: true, maxItems: 1 };
  }
  if (actorId === "memo23/gumtree-cheerio") {
    return { startUrls: [{ url }], includeListingDetails: true, maxResults: 1 };
  }
  if (actorId === "curious_coder/facebook-marketplace") {
    return { urls: [url], getListingDetails: true, getAllListingPhotos: true, maxPagesPerUrl: 1 };
  }
  return { startUrls: [{ url }], maxItems: 1 };
}

// ─── Platform-specific item normalisers ───────────────────────────────────────

function normalizeFacebookMarketplaceItem(
  item: Record<string, unknown>,
): Omit<ApifyExtractorResult, "skipped" | "error" | "actor_used"> {
  const title = (item["listingTitle"] ?? item["customTitle"] ?? item["title"] ?? null) as string | null;

  const priceObj = item["listingPrice"] as { amount?: string; currency?: string } | null;
  let price: string | null = null;
  if (priceObj?.amount) {
    const amount = parseFloat(priceObj.amount);
    const currency = priceObj.currency ?? "";
    price = `${currency} ${amount.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`.trim();
  }

  const descObj = item["description"] as { text?: string } | null;
  const description = (descObj?.text ?? null) as string | null;

  const locationTextObj = item["locationText"] as { text?: string } | null;
  const locationObj = item["location"] as {
    reverse_geocode?: {
      city?: string;
      state?: string;
      city_page?: { display_name?: string };
    };
  } | null;

  let location: string | null = null;
  if (locationTextObj?.text) {
    location = locationTextObj.text;
  } else if (locationObj?.reverse_geocode?.city_page?.display_name) {
    location = locationObj.reverse_geocode.city_page.display_name;
  } else if (locationObj?.reverse_geocode?.city) {
    const city = locationObj.reverse_geocode.city;
    const state = locationObj.reverse_geocode.state ?? "";
    location = [city, state].filter(Boolean).join(", ");
  }

  const listingPhotos = item["listingPhotos"] as Array<{
    image?: { uri?: string };
  }> | null;
  const images: string[] = [];
  if (Array.isArray(listingPhotos)) {
    for (const photo of listingPhotos) {
      const uri = photo?.image?.uri;
      if (uri && typeof uri === "string") images.push(uri);
    }
  }

  const conditionRaw = item["condition"] as string | null;
  const condition = conditionRaw
    ? conditionRaw.charAt(0).toUpperCase() + conditionRaw.slice(1).toLowerCase()
    : null;

  const listed_date = (item["timestamp"] as string) ?? null;

  return {
    title,
    price,
    description,
    seller_name: null,
    seller_profile_url: null,
    seller_member_since: null,
    seller_review_count: null,
    seller_rating: null,
    location,
    condition,
    category: null,
    listed_date,
    images,
    attributes: {},
    raw: item,
  };
}

function normalizeGumtreeItem(
  item: Record<string, unknown>,
): Omit<ApifyExtractorResult, "skipped" | "error" | "actor_used"> {
  const title = (item["title"] ?? item["name"] ?? item["heading"] ?? null) as string | null;

  let price: string | null = null;
  const rawPrice = item["price"] ?? item["priceText"] ?? item["price_text"];
  if (typeof rawPrice === "string") {
    price = rawPrice;
  } else if (typeof rawPrice === "object" && rawPrice !== null) {
    const p = rawPrice as Record<string, unknown>;
    price = (p["formatted"] ?? p["amount"] ?? p["value"] ?? null) as string | null;
  }

  const description = (item["description"] ?? item["body"] ?? null) as string | null;

  const sellerObj = item["seller"] as Record<string, unknown> | undefined;
  const seller_name = (
    item["sellerName"] ?? sellerObj?.["name"] ?? item["seller_name"] ?? null
  ) as string | null;
  const seller_profile_url = (
    item["sellerUrl"] ?? sellerObj?.["profileUrl"] ?? sellerObj?.["url"] ?? null
  ) as string | null;
  const seller_member_since = (
    item["memberSince"] ?? sellerObj?.["memberSince"] ?? null
  ) as string | null;
  const seller_review_count = (
    item["reviewCount"] ?? sellerObj?.["reviewCount"] ?? null
  ) as number | null;
  const seller_rating = (
    item["rating"] ?? sellerObj?.["rating"] ?? null
  ) as number | null;

  let location: string | null = null;
  const rawLocation = item["location"] ?? item["locationText"] ?? item["suburb"];
  if (typeof rawLocation === "string") {
    location = rawLocation;
  } else if (typeof rawLocation === "object" && rawLocation !== null) {
    const l = rawLocation as Record<string, unknown>;
    location = (l["text"] ?? l["display_name"] ?? l["suburb"] ?? null) as string | null;
  }

  const condition = (item["condition"] ?? item["itemCondition"] ?? null) as string | null;
  const category = (item["category"] ?? item["categoryName"] ?? null) as string | null;
  const listed_date = (
    item["listedAt"] ?? item["postedAt"] ?? item["date"] ?? item["timestamp"] ?? null
  ) as string | null;

  const images: string[] = [];
  const rawImages = item["images"] ?? item["imageUrls"] ?? item["photos"] ?? item["media"];
  if (Array.isArray(rawImages)) {
    for (const img of rawImages) {
      if (typeof img === "string") {
        images.push(img);
      } else if (typeof img === "object" && img !== null) {
        const imgObj = img as Record<string, unknown>;
        const uri = imgObj["uri"] ?? imgObj["url"] ?? imgObj["src"] ?? imgObj["href"];
        if (typeof uri === "string") images.push(uri);
      }
    }
  }

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
    attributes: {},
    raw: item,
  };
}

function normalizeGenericItem(
  item: Record<string, unknown>,
): Omit<ApifyExtractorResult, "skipped" | "error" | "actor_used"> {
  const title = toStringOrNull(item.title ?? item.name ?? item.heading);
  const price = toStringOrNull(item.price ?? item.priceText ?? item.price_text);
  const description = toStringOrNull(item.description ?? item.body ?? item.details);

  const sellerRaw = (item.seller ?? {}) as Record<string, unknown>;
  const seller_name = toStringOrNull(item.sellerName ?? item.seller_name ?? sellerRaw.name);
  const seller_profile_url = toStringOrNull(item.sellerUrl ?? sellerRaw.profileUrl);
  const seller_member_since = toStringOrNull(item.memberSince ?? sellerRaw.memberSince);
  const seller_review_count = toNumberOrNull(item.reviewCount ?? sellerRaw.reviewCount);
  const seller_rating = toNumberOrNull(item.rating ?? sellerRaw.rating);

  const location = toStringOrNull(item.location ?? item.locationText ?? item.city);
  const condition = toStringOrNull(item.condition ?? item.itemCondition);
  const category = toStringOrNull(item.category ?? item.breadcrumb);
  const listed_date = toStringOrNull(item.listedAt ?? item.postedAt ?? item.date);

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
  };
}

// ─── Core actor runner ────────────────────────────────────────────────────────
// Calls one Apify actor, fetches the first dataset item, and normalises it.

async function runApifyActor(
  actorId: string,
  url: string,
  platform: string,
): Promise<ApifyExtractorResult> {
  const { ApifyClient } = await import("apify-client");
  const client = new ApifyClient({ token: process.env["APIFY_API_TOKEN"]! });

  logger.info({ url, platform, actorId }, "Calling Apify actor");

  const run = await client.actor(actorId).call(
    buildActorInput(actorId, url),
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

  let normalized: Omit<ApifyExtractorResult, "skipped" | "error" | "actor_used">;
  if (actorId === "apify/facebook-marketplace-scraper") {
    normalized = normalizeFacebookMarketplaceItem(item);
  } else if (platform === "gumtree") {
    normalized = normalizeGumtreeItem(item);
  } else {
    normalized = normalizeGenericItem(item);
  }

  const result: ApifyExtractorResult = {
    ...normalized,
    skipped: false,
    error: null,
    actor_used: actorId,
  };

  logger.info(
    { url, platform, actorId, title: result.title, price: result.price },
    "Apify actor run complete",
  );

  return result;
}

// ─── Public extractor ─────────────────────────────────────────────────────────

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

  // ── Gumtree: try primary actor, fall back to secondary if empty ─────────────
  if (platform === "gumtree") {
    let primaryResult: ApifyExtractorResult;
    try {
      primaryResult = await runApifyActor(actorId, url, platform);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ url, actorId, error: msg }, "Gumtree primary actor threw — trying fallback");
      primaryResult = errorResult(actorId, msg);
    }

    const primaryOk =
      !primaryResult.error &&
      (primaryResult.title || primaryResult.price || primaryResult.images.length > 0);

    if (primaryOk) return primaryResult;

    const fallbackId = PLATFORM_ACTORS["gumtree_fallback"];
    if (fallbackId) {
      logger.info({ url, fallbackId }, "Gumtree primary returned empty — trying fallback actor");
      try {
        return await runApifyActor(fallbackId, url, platform);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ url, fallbackId, error: msg }, "Gumtree fallback actor also failed");
        return errorResult(fallbackId, msg);
      }
    }

    return primaryResult;
  }

  // ── All other platforms ─────────────────────────────────────────────────────
  try {
    return await runApifyActor(actorId, url, platform);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ url, platform, actorId, error: msg }, "Apify extraction failed");
    return errorResult(actorId, msg);
  }
}
