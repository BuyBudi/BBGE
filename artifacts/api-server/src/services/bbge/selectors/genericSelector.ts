// Generic fallback selector — uses Open Graph meta tags and visible text heuristics

import type { Page } from "playwright";
import type { SelectorExtractResult } from "./types.js";
import { tryAttrSelectors, cleanText, detectBlockedPage } from "./types.js";

const PRICE_REGEX = /(?:AUD|USD|CAD|GBP|EUR|NZD)?\s*\$[\d,]+(?:\.\d{1,2})?|\$[\d,]+(?:\.\d{1,2})?|AUD\s*[\d,]+/gi;

export async function extractGeneric(
  page: Page,
  _html: string,
  visibleText: string,
): Promise<SelectorExtractResult> {
  const debug: Record<string, string> = {};

  let pageTitle: string | null = null;
  try { pageTitle = await page.title(); } catch {}
  const is_blocked = detectBlockedPage(visibleText, pageTitle);

  // Title
  const ogTitle = await tryAttrSelectors(page, [
    { sel: "meta[property='og:title']", attr: "content" },
    { sel: "meta[name='title']", attr: "content" },
  ]);
  let title = cleanText(ogTitle.value);
  if (ogTitle.matched && title) {
    debug["title"] = ogTitle.matched;
  } else {
    try {
      const h1 = page.locator("h1").first();
      if ((await h1.count()) > 0) {
        title = cleanText(await h1.innerText({ timeout: 2000 }));
        if (title) debug["title"] = "h1";
      }
    } catch {}
  }

  // Description
  const ogDesc = await tryAttrSelectors(page, [
    { sel: "meta[property='og:description']", attr: "content" },
    { sel: "meta[name='description']", attr: "content" },
  ]);
  const description = cleanText(ogDesc.value);
  if (ogDesc.matched && description) debug["description"] = ogDesc.matched;

  // Price
  let price: string | null = null;
  const priceMatches = visibleText.match(PRICE_REGEX);
  if (priceMatches && priceMatches.length > 0) {
    price = priceMatches[0].trim();
    debug["price"] = "regex:price_pattern";
  }

  // Images
  const ogImage = await tryAttrSelectors(page, [
    { sel: "meta[property='og:image']", attr: "content" },
  ]);
  const ogImageUrl = ogImage.value;
  if (ogImage.matched && ogImageUrl) debug["images"] = ogImage.matched;

  const images: string[] = [];
  if (ogImageUrl && ogImageUrl.startsWith("http")) images.push(ogImageUrl);
  try {
    const pageImgs = await page.locator("img[src]").evaluateAll(
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
          .slice(0, 18),
    );
    pageImgs.forEach((u) => { if (!images.includes(u)) images.push(u); });
  } catch {}

  return {
    title,
    price,
    description,
    seller_name: null,
    location: null,
    images: images.slice(0, 20),
    is_blocked,
    selector_debug: debug,
  };
}
