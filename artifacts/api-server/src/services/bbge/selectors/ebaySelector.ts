// eBay platform-specific field selector

import type { Page } from "playwright";
import type { SelectorExtractResult } from "./types.js";
import { trySelectors, tryAttrSelectors, cleanText } from "./types.js";

const PRICE_SELECTORS = [
  "[itemprop='price']",
  ".x-price-primary",
  ".ux-textspans--BOLD",
  "[data-testid='x-price-primary']",
  ".notranslate",
];

const DESCRIPTION_SELECTORS = [
  "#viTabs_0_is",
  ".d-item-description",
  "[itemprop='description']",
  "#desc_div",
  ".itemAttr",
];

const SELLER_SELECTORS = [
  ".seller-persona a",
  ".x-sellercard-atf__info__about-seller",
  "[data-testid='x-seller-info'] a",
];

export async function extractEbay(page: Page): Promise<SelectorExtractResult> {
  const debug: Record<string, string> = {};

  // Title — prefer og:title meta or page title
  const titleMeta = await tryAttrSelectors(page, [
    { sel: "meta[property='og:title']", attr: "content" },
    { sel: "meta[name='title']", attr: "content" },
  ]);
  const titleEl = titleMeta.value
    ? titleMeta
    : await trySelectors(page, ["h1[itemprop='name']", ".x-item-title__mainTitle", "h1.it-ttl"]);
  const title = cleanText(titleEl.value);
  if (titleEl.matched) debug["title"] = titleEl.matched;

  // Price
  const priceEl = await trySelectors(page, PRICE_SELECTORS);
  const price = cleanText(priceEl.value);
  if (priceEl.matched) debug["price"] = priceEl.matched;

  // Description — try to extract from iframe or direct div
  const descEl = await trySelectors(page, DESCRIPTION_SELECTORS);
  const description = cleanText(descEl.value);
  if (descEl.matched) debug["description"] = descEl.matched;

  // Seller
  const sellerEl = await trySelectors(page, SELLER_SELECTORS);
  const seller_name = cleanText(sellerEl.value);
  if (sellerEl.matched) debug["seller_name"] = sellerEl.matched;

  // Images — eBay-specific CDN
  let images: string[] = [];
  try {
    images = await page.locator("img[src*='i.ebayimg.com']").evaluateAll(
      (imgs) =>
        (imgs as HTMLImageElement[])
          .map((img) => img.src || img.getAttribute("data-src") || "")
          .filter((src) => src && src.startsWith("http") && !src.includes("s-l64") && !src.includes("s-l140"))
          .slice(0, 20),
    );
    if (images.length > 0) debug["images"] = "img[src*='i.ebayimg.com']";
  } catch {
    images = [];
  }

  return { title, price, description, seller_name, images, selector_debug: debug };
}
