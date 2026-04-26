// Facebook Marketplace platform-specific field extractor
// Facebook aggressively uses dynamic class names, so we rely heavily on
// visible text parsing and regex rather than CSS selectors alone.

import type { Page } from "playwright";
import type { SelectorExtractResult } from "./types.js";
import { cleanText } from "./types.js";

const PRICE_REGEX = /(?:AUD|USD|CAD|GBP|EUR|NZD)?\s*\$[\d,]+(?:\.\d{1,2})?|\$[\d,]+(?:\.\d{1,2})?|AUD\s*[\d,]+/gi;
const SELLER_CONTEXT_LABELS = ["Seller", "Listed by", "Joined", "Profile", "Member since"];

export async function extractFacebook(page: Page): Promise<SelectorExtractResult> {
  const debug: Record<string, string> = {};

  // Grab full visible text of the page
  let visibleText = "";
  try {
    visibleText = await page.evaluate(() => {
      const body = document.body;
      const clone = body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
      return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
    });
  } catch {
    visibleText = "";
  }

  // Title — try h1 or og:title
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

  // Seller — look for context labels in text, then grab the next word/phrase
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

  // Description — try aria-label or visible text block after title
  let description: string | null = null;
  try {
    const descEl = page.locator("[data-testid='marketplace-pdp-description'], [class*='description']").first();
    if ((await descEl.count()) > 0) {
      description = cleanText(await descEl.innerText({ timeout: 2000 }));
      if (description) debug["description"] = "[data-testid='marketplace-pdp-description']";
    }
  } catch {}
  if (!description && visibleText.length > 200) {
    // Fall back to a block of text that seems like a listing description
    const lines = visibleText.split(". ").filter((l) => l.trim().length > 20);
    if (lines.length > 0) {
      description = cleanText(lines.slice(0, 5).join(". "));
      if (description) debug["description"] = "visible_text_heuristic";
    }
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

  return { title, price, description, seller_name, images, selector_debug: debug };
}
