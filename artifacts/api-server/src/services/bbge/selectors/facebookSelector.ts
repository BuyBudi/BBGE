// Facebook Marketplace platform-specific field extractor

import type { Page } from "playwright";
import type { SelectorExtractResult } from "./types.js";
import { cleanText, detectBlockedPage } from "./types.js";

const PRICE_REGEX = /(?:AUD|USD|CAD|GBP|EUR|NZD)?\s*\$[\d,]+(?:\.\d{1,2})?|\$[\d,]+(?:\.\d{1,2})?|AUD\s*[\d,]+/gi;
const SELLER_CONTEXT_LABELS = ["Seller", "Listed by", "Joined", "Profile", "Member since"];

export async function extractFacebook(
  page: Page,
  _html: string,
  visibleText: string,
): Promise<SelectorExtractResult> {
  const debug: Record<string, string> = {};

  let pageTitle: string | null = null;
  try { pageTitle = await page.title(); } catch {}
  const is_blocked = detectBlockedPage(visibleText, pageTitle);

  // Title
  let title: string | null = null;
  try {
    const h1 = page.locator("h1").first();
    if ((await h1.count()) > 0) {
      title = cleanText(await h1.innerText({ timeout: 2000 }));
      if (title) debug["title"] = "h1";
    }
  } catch {}
  if (!title) {
    try {
      const ogTitle = await page.locator("meta[property='og:title']").getAttribute("content", { timeout: 1000 });
      title = cleanText(ogTitle);
      if (title) debug["title"] = "meta[og:title]";
    } catch {}
  }

  // Price — regex on visible text
  let price: string | null = null;
  const priceMatches = visibleText.match(PRICE_REGEX);
  if (priceMatches && priceMatches.length > 0) {
    price = priceMatches[0].trim();
    debug["price"] = "regex:price_pattern";
  }

  // Seller
  let seller_name: string | null = null;
  for (const label of SELLER_CONTEXT_LABELS) {
    const idx = visibleText.indexOf(label);
    if (idx !== -1) {
      const after = visibleText.slice(idx + label.length, idx + label.length + 80).trim();
      const candidate = after.split(/[\n.]/)[0].trim();
      if (candidate && candidate.length > 1 && candidate.length < 60) {
        seller_name = cleanText(candidate);
        debug["seller_name"] = `text_context:${label}`;
        break;
      }
    }
  }

  // Description
  let description: string | null = null;
  try {
    const descEl = page.locator("[data-testid='marketplace-pdp-description'], [class*='description']").first();
    if ((await descEl.count()) > 0) {
      description = cleanText(await descEl.innerText({ timeout: 2000 }));
      if (description) debug["description"] = "[data-testid='marketplace-pdp-description']";
    }
  } catch {}
  if (!description && visibleText.length > 200) {
    const lines = visibleText.split(". ").filter((l) => l.trim().length > 20);
    if (lines.length > 0) {
      description = cleanText(lines.slice(0, 5).join(". "));
      if (description) debug["description"] = "visible_text_heuristic";
    }
  }

  // Location — Facebook often shows city in the listing
  let location: string | null = null;
  const locIdx = visibleText.toLowerCase().indexOf("listed in ");
  if (locIdx !== -1) {
    const after = visibleText.slice(locIdx + 10, locIdx + 60).split(/[\n,]/)[0].trim();
    if (after) { location = after; debug["location"] = "text_context:listed_in"; }
  }

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
              (src.includes("fbcdn") || src.includes("scontent")) &&
              !src.includes("icon") &&
              !src.includes("emoji"),
          )
          .slice(0, 20),
    );
    if (images.length > 0) debug["images"] = "img[src](fbcdn filter)";
  } catch {
    images = [];
  }

  return { title, price, description, seller_name, location, images, is_blocked, selector_debug: debug };
}
