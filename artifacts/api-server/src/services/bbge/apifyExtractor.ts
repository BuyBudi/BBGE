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
// Gumtree goes directly to memo23/gumtree-cheerio (crawlerbros always returns empty).
export const PLATFORM_ACTORS: Record<string, string> = {
  facebook_marketplace: "apify/facebook-marketplace-scraper",
  gumtree: "memo23/gumtree-cheerio",
  depop: "abotapi/depop-scraper",
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
  if (actorId === "abotapi/depop-scraper") {
    // Verified 2026-09-19 on one live listing: url mode with fetchDetails
    // returns item, seller and condition fields. Residential proxy set
    // explicitly so the per-run cost cannot change under a default.
    return {
      mode: "url",
      urls: [url],
      maxListings: 1,
      fetchDetails: true,
      proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
    };
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

  const uniqueImages = [...new Set(images)];

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
    images: uniqueImages,
    attributes: {},
    raw: item,
  };
}

function normalizeGumtreeItem(
  item: Record<string, unknown>,
): Omit<ApifyExtractorResult, "skipped" | "error" | "actor_used"> {

  // ── Title ───────────────────────────────────────────────────────────────
  const title = (item["title"] ?? null) as string | null;

  // ── Price ───────────────────────────────────────────────────────────────
  // Primary: adPriceData.priceText (already formatted, e.g. "$57,000")
  // Fallback: format from adPriceData.amount + currency
  let price: string | null = null;
  const priceData = item["adPriceData"] as Record<string, unknown> | undefined;
  if (priceData) {
    if (typeof priceData["priceText"] === "string") {
      price = priceData["priceText"]; // use as-is: "$57,000" — already formatted
    } else if (typeof priceData["amount"] === "number" && (priceData["amount"] as number) > 0) {
      const formatted = (priceData["amount"] as number).toLocaleString("en-AU");
      price = `$${formatted}`; // e.g. "$57,000"
    }
  }

  // ── Description ─────────────────────────────────────────────────────────
  const description = (item["description"] ?? null) as string | null;

  // ── Location ────────────────────────────────────────────────────────────
  // Primary: adLocationData.mapAddress (e.g. "Como, WA")
  // Fallback: construct from suburb + state
  let location: string | null = null;
  const locationData = item["adLocationData"] as Record<string, unknown> | undefined;
  if (locationData) {
    if (typeof locationData["mapAddress"] === "string") {
      location = locationData["mapAddress"];
    } else {
      const suburb = locationData["suburb"] as string | undefined;
      const state = locationData["state"] as string | undefined;
      location = [suburb, state].filter(Boolean).join(", ") || null;
    }
  }
  // Secondary fallback: listingInfo array
  if (!location) {
    const listingInfo = item["listingInfo"] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(listingInfo)) {
      const locationEntry = listingInfo.find((e) => e["name"] === "Location");
      if (locationEntry) location = (locationEntry["value"] as string) ?? null;
    }
  }

  // ── Seller ──────────────────────────────────────────────────────────────
  const posterData = item["adPosterData"] as Record<string, unknown> | undefined;
  const seller_name = (posterData?.["name"] as string | undefined)?.trim() ?? null;

  const otherListingsPath = posterData?.["otherListingsUrl"] as string | undefined;
  const seller_profile_url = otherListingsPath
    ? `https://www.gumtree.com.au${otherListingsPath}`
    : null;

  const seller_member_since = (posterData?.["memberSince"] as string | undefined) ?? null;
  const seller_review_count: number | null = null;
  const seller_rating: number | null = null;

  // ── Images ──────────────────────────────────────────────────────────────
  // Use "large" URL from each image object for best quality
  const images: string[] = [];
  const rawImages =
    (item["images"] as Array<Record<string, unknown>> | undefined) ??
    ((item["media"] as Record<string, unknown> | undefined)?.["images"] as
      | Array<Record<string, unknown>>
      | undefined);

  if (Array.isArray(rawImages)) {
    for (const img of rawImages) {
      const uri =
        (img["large"] as string | undefined) ??
        (img["xlarge"] as string | undefined) ??
        (img["baseurl"] as string | undefined) ??
        (img["small"] as string | undefined);
      if (uri) images.push(uri);
    }
  }

  // ── Category ────────────────────────────────────────────────────────────
  const category = (item["categoryName"] as string | undefined) ?? null;

  // ── Condition ───────────────────────────────────────────────────────────
  const condition: string | null = null;

  // ── Listed date ─────────────────────────────────────────────────────────
  let listed_date: string | null = null;
  const listingInfo = item["listingInfo"] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(listingInfo)) {
    const dateEntry = listingInfo.find((e) => e["name"] === "Date Listed");
    if (dateEntry) listed_date = (dateEntry["value"] as string) ?? null;
  }
  if (!listed_date) {
    listed_date = (item["scrapedAt"] as string | undefined) ?? null;
  }

  // ── Attributes ──────────────────────────────────────────────────────────
  // Extract categoryInfo array into a flat key-value Record
  const attributes: Record<string, string> = {};
  const categoryInfo = item["categoryInfo"] as
    | Array<{ name: string; value: string }>
    | undefined;
  if (Array.isArray(categoryInfo)) {
    for (const entry of categoryInfo) {
      if (entry.name && entry.value) {
        attributes[entry.name] = entry.value;
      }
    }
  }

  const uniqueImages = [...new Set(images)];

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
    images: uniqueImages,
    attributes,
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
  const images: string[] = [
    ...new Set(
      Array.isArray(rawImages)
        ? (rawImages as unknown[]).map((i) => String(i)).filter((s) => s.startsWith("http"))
        : [],
    ),
  ];

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

// abotapi/depop-scraper, url mode with fetchDetails (verified 2026-09-19 on one
// live listing).
// NOT mapped, deliberately: sellerFirstName, sellerLastName, sellerPictureUrl and
// sellerRaw. A private seller's real name and photo have no scoring use and must
// not travel downstream; raw is a whitelist for the same reason.
// seller_rating is left null: Depop rates 0-5 stars, and Chekka's
// sellerCredibilityScore reads ratingValue as a percentage (5.0 would score as
// 5%). The star value is kept in attributes.rating_out_of_5 until Chekka settles
// one scale.
// price is "<CUR> <amount>" so Chekka's parsePrice keeps the currency; emitted
// only for the currencies parsePrice recognises, since any other would silently
// become AUD there.
const DEPOP_PARSEABLE_CURRENCIES = new Set(["AUD", "USD", "GBP", "EUR", "NZD"]);

const DEPOP_RAW_KEYS = [
  "id",
  "slug",
  "url",
  "status",
  "isOnSale",
  "countryCode",
  "price",
  "currency",
  "sellerId",
  "sellerUsername",
  "sellerReviewsRating",
  "sellerReviewsTotal",
  "sellerItemsSold",
  "sellerLastSeen",
  "sellerVerified",
];

function normalizeDepopItem(
  item: Record<string, unknown>,
): Omit<ApifyExtractorResult, "skipped" | "error" | "actor_used"> {
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const amount = num(item["price"]);
  const currency = str(item["currency"])?.toUpperCase() ?? null;
  const price =
    amount !== null && currency !== null && DEPOP_PARSEABLE_CURRENCIES.has(currency)
      ? `${currency} ${amount.toFixed(2)}`
      : null;

  const username = str(item["sellerUsername"]);
  const images = Array.isArray(item["pictures"])
    ? (item["pictures"] as unknown[]).filter((p): p is string => typeof p === "string")
    : [];

  const attributes: Record<string, string> = {};
  const put = (key: string, v: unknown): void => {
    if (typeof v === "string" && v.length > 0) attributes[key] = v;
    else if (typeof v === "number" || typeof v === "boolean") attributes[key] = String(v);
  };
  put("brand", item["brandName"]);
  put("status", item["status"]);
  put("is_on_sale", item["isOnSale"]);
  put("country_code", item["countryCode"]);
  put("rating_out_of_5", item["sellerReviewsRating"]);
  put("seller_items_sold", item["sellerItemsSold"]);
  put("seller_last_seen", item["sellerLastSeen"]);
  put("seller_verified", item["sellerVerified"]);
  put("shipping_cost", item["shippingCost"]);
  if (Array.isArray(item["sizes"])) {
    const names = (item["sizes"] as unknown[])
      .map((s) =>
        s !== null && typeof s === "object" && typeof (s as Record<string, unknown>)["name"] === "string"
          ? ((s as Record<string, unknown>)["name"] as string)
          : null,
      )
      .filter((s): s is string => s !== null);
    if (names.length > 0) attributes["sizes"] = names.join(", ");
  }

  const raw: Record<string, unknown> = {};
  for (const key of DEPOP_RAW_KEYS) {
    if (key in item) raw[key] = item[key];
  }

  return {
    title: str(item["title"]),
    price,
    description: str(item["description"]),
    seller_name: username,
    seller_profile_url: username ? `https://www.depop.com/${username}/` : null,
    seller_member_since: null,
    seller_review_count: num(item["sellerReviewsTotal"]),
    seller_rating: null,
    location: str(item["address"]),
    condition: str(item["conditionName"]),
    category: str(item["categoryName"]),
    listed_date: null,
    images,
    attributes,
    raw,
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
    { waitSecs: 60 },
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
  } else if (actorId === "abotapi/depop-scraper") {
    normalized = normalizeDepopItem(item);
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

  try {
    return await runApifyActor(actorId, url, platform);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ url, platform, actorId, error: msg }, "Apify extraction failed");
    return errorResult(actorId, msg);
  }
}
