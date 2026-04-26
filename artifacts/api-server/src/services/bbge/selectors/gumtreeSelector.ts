// Gumtree platform-specific field selector

import type { Page } from "playwright";
import type { SelectorExtractResult } from "./types.js";
import { trySelectors, tryAttrSelectors, cleanText, detectBlockedPage } from "./types.js";

const PRICE_SELECTORS = [
  "[data-q='ad-price']",
  "[class*='price']",
  "[class*='Price']",
  ".ad-price",
  "h3[class*='price']",
];

const DESCRIPTION_SELECTORS = [
  "[data-q='vip-description']",
  "[class*='description']",
  "[class*='Description']",
  ".vip-description",
];

const SELLER_SELECTORS = [
  "[data-q='seller-name']",
  "[class*='seller']",
  "[class*='Seller']",
  "[class*='advertiser']",
];

const LOCATION_SELECTORS = [
  "[data-q='ad-location']",
  "[class*='location']",
  "[class*='Location']",
];

export async function extractGumtree(
  page: Page,
  _html: string,
  visibleText: string,
): Promise<SelectorExtractResult> {
  const debug: Record<string, string> = {};

  let pageTitle: string | null = null;
  try { pageTitle = await page.title(); } catch {}
  const is_blocked = detectBlockedPage(visibleText, pageTitle);

  // Title
  const titleEl = await trySelectors(page, ["h1[class*='title']", "h1[class*='Title']", "[data-q='vip-title']"]);
  const titleFallback = await tryAttrSelectors(page, [{ sel: "meta[property='og:title']", attr: "content" }]);
  const title = cleanText(titleEl.value ?? titleFallback.value);
  if (titleEl.matched) debug["title"] = titleEl.matched;
  else if (titleFallback.matched) debug["title"] = titleFallback.matched;

  // Price
  const priceEl = await trySelectors(page, PRICE_SELECTORS);
  const price = cleanText(priceEl.value);
  if (priceEl.matched) debug["price"] = priceEl.matched;

  // Description
  const descEl = await trySelectors(page, DESCRIPTION_SELECTORS);
  const description = cleanText(descEl.value);
  if (descEl.matched) debug["description"] = descEl.matched;

  // Seller
  const sellerEl = await trySelectors(page, SELLER_SELECTORS);
  const seller_name = cleanText(sellerEl.value);
  if (sellerEl.matched) debug["seller_name"] = sellerEl.matched;

  // Location
  const locationEl = await trySelectors(page, LOCATION_SELECTORS);
  const location = cleanText(locationEl.value);
  if (locationEl.matched) debug["location"] = locationEl.matched;

  // Images
  let images: string[] = [];
  try {
    images = await page.locator("img[src]").evaluateAll(
      (imgs) =>
        (imgs as HTMLImageElement[])
          .map((img) => img.src || "")
          .filter(
            (src) =>
              src.startsWith("http") &&
              !src.includes("icon") &&
              !src.includes("logo") &&
              !src.includes("pixel"),
          )
          .slice(0, 20),
    );
    if (images.length > 0) debug["images"] = "img[src]";
  } catch {
    images = [];
  }

  return { title, price, description, seller_name, location, images, is_blocked, selector_debug: debug };
}
