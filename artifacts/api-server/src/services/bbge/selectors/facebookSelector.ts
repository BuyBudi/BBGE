// Facebook Marketplace platform-specific field extractor
// Note: Facebook heavily obfuscates class names; we rely on text patterns + aria roles + visible text.

import type { Page } from "playwright";
import type { SelectorExtractResult } from "./types.js";
import { cleanText, detectBlockedPage } from "./types.js";

// Price: handle $650, $1,250, AUD 900, Free — filter out noise
const PRICE_REGEX =
  /\bFree\b|(?:AUD|USD|CAD|GBP|EUR|NZD)\s*[\d,]+(?:\.\d{1,2})?|(?:AUD|USD|\$)\s*[\d,]+(?:\.\d{1,2})?|\$[\d,]+(?:\.\d{1,2})?/gi;

const PRICE_IGNORE_WORDS = ["shipping", "discount", "save $", "postage", "delivery", "fee"];

// Seller context: Facebook's dynamic class names change constantly; use text signals
const SELLER_LABELS = [
  "Seller details",
  "Marketplace profile",
  "Joined Facebook",
  "Send message",
  "View seller profile",
  "Listed by",
  "Member since",
];

// Location: suburb names, distance phrases, pickup phrases
const LOCATION_LABELS = [
  "listed in",
  "pickup in",
  "pickup from",
  "kilometres away",
  "kilometers away",
  "km away",
  "located in",
];

function extractPriceFromText(text: string): string | null {
  const lines = text.split(/\n/);
  for (const line of lines) {
    const low = line.toLowerCase();
    if (PRICE_IGNORE_WORDS.some((w) => low.includes(w))) continue;
    const matches = line.match(PRICE_REGEX);
    if (matches && matches.length > 0) {
      return matches[0].trim();
    }
  }
  return null;
}

function extractSellerFromText(text: string): string | null {
  for (const label of SELLER_LABELS) {
    const idx = text.toLowerCase().indexOf(label.toLowerCase());
    if (idx === -1) continue;

    // The seller name is typically on the SAME or NEXT line as the label
    const segment = text.slice(idx, idx + 200);
    const lines = segment.split(/\n/).map((l) => l.trim()).filter(Boolean);

    // First line is the label itself; the name might be in the same line after a colon
    // or the very next non-empty line
    for (let i = 0; i < Math.min(lines.length, 4); i++) {
      const line = lines[i];
      // Skip the label line itself and generic UI text
      const skip = [
        label.toLowerCase(),
        "view seller profile",
        "send message",
        "see all",
        "details",
        "profile",
        "facebook",
      ];
      if (skip.some((s) => line.toLowerCase().includes(s))) continue;
      if (line.length > 1 && line.length < 60) {
        return cleanText(line);
      }
    }
  }
  return null;
}

function extractLocationFromText(text: string): string | null {
  const lower = text.toLowerCase();

  // Look for "N kilometres away" — take the suburb that usually appears before it
  const distMatch = text.match(/(\d+)\s*(?:kilometres|kilometers|km)\s*away/i);
  if (distMatch) {
    const idx = text.indexOf(distMatch[0]);
    // Look back up to 80 chars for a suburb name
    const before = text.slice(Math.max(0, idx - 80), idx);
    const lines = before.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const suburb = lines[lines.length - 1];
    if (suburb && suburb.length > 1 && suburb.length < 60) return suburb;
  }

  // Look for "Listed in ...", "Pickup in ...", "Pickup from ..."
  for (const label of LOCATION_LABELS) {
    const idx = lower.indexOf(label);
    if (idx === -1) continue;
    const after = text.slice(idx + label.length, idx + label.length + 80).trim();
    const firstPart = after.split(/[\n,·•]/)[0].trim();
    if (firstPart && firstPart.length > 1 && firstPart.length < 60) {
      return cleanText(firstPart);
    }
  }

  return null;
}

export async function extractFacebook(
  page: Page,
  _html: string,
  visibleText: string,
): Promise<SelectorExtractResult> {
  const debug: Record<string, string> = {};

  let pageTitle: string | null = null;
  try { pageTitle = await page.title(); } catch {}
  const is_blocked = detectBlockedPage(visibleText, pageTitle);

  // ----- FACEBOOK EXTRA RENDER WAIT -----
  // Facebook's React app can take longer to hydrate listings
  if (!is_blocked) {
    try {
      await page.waitForTimeout(3500);
      // Slow scroll to roughly 50% of page height
      await page.evaluate(() => {
        const half = document.body.scrollHeight / 2;
        window.scrollTo({ top: half, behavior: "smooth" });
      });
      await page.waitForTimeout(1200);
      // Scroll back to top before extracting
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
      await page.waitForTimeout(600);
    } catch {}

    // Re-collect visible text after scroll (page may have lazy-loaded content)
    try {
      const freshHtml = await page.content();
      const freshText = freshHtml
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 15000);
      if (freshText.length > visibleText.length) {
        visibleText = freshText;
      }
    } catch {}
  }

  // ----- TITLE -----
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

  // ----- PRICE -----
  let price: string | null = null;

  // Try aria-label on price elements first
  try {
    const priceEl = page.locator("[aria-label*='price' i], [aria-label*='Price' i]").first();
    if ((await priceEl.count()) > 0) {
      const text = cleanText(await priceEl.innerText({ timeout: 2000 }));
      if (text) { price = text; debug["price"] = "aria-label:price"; }
    }
  } catch {}

  // Visible text regex (line-by-line with filter)
  if (!price && !is_blocked) {
    const fromText = extractPriceFromText(visibleText);
    if (fromText) {
      price = fromText;
      debug["price"] = "visible_text_regex";
    }
  }

  // ----- SELLER -----
  let seller_name: string | null = null;

  // Try aria-label patterns
  try {
    const sellerEl = page.locator("[aria-label*='seller' i], [aria-label*='profile' i]").first();
    if ((await sellerEl.count()) > 0) {
      const text = cleanText(await sellerEl.getAttribute("aria-label"));
      if (text && text.length < 60) { seller_name = text; debug["seller_name"] = "aria-label:seller"; }
    }
  } catch {}

  // Visible text context
  if (!seller_name && !is_blocked) {
    const fromText = extractSellerFromText(visibleText);
    if (fromText) {
      seller_name = fromText;
      debug["seller_name"] = "visible_text_context";
    }
  }

  // ----- LOCATION -----
  let location: string | null = null;

  if (!is_blocked) {
    const fromText = extractLocationFromText(visibleText);
    if (fromText) {
      location = fromText;
      debug["location"] = "visible_text_context";
    }
  }

  // ----- DESCRIPTION -----
  let description: string | null = null;
  try {
    const descEl = page
      .locator(
        "[data-testid='marketplace-pdp-description'], [aria-label*='description' i], [class*='description']",
      )
      .first();
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

  // ----- IMAGES -----
  // Only include actual listing product photos.
  // Exclude: static.xx.fbcdn.net (UI sprites/icons), rsrc.php paths (bundled assets),
  //          profile placeholders, login-page graphics, icons, emoji, tiny images.
  let images: string[] = [];
  try {
    images = await page.locator("img[src]").evaluateAll(
      (imgs) =>
        (imgs as HTMLImageElement[])
          .map((img) => img.src || "")
          .filter((src) => {
            if (!src.startsWith("http")) return false;
            // Must be a Facebook CDN domain
            if (!src.includes("fbcdn") && !src.includes("scontent")) return false;
            // Exclude static asset CDN (logos, sprites, UI icons)
            if (src.includes("static.xx.fbcdn.net")) return false;
            if (src.includes("static.ak.fbcdn.net")) return false;
            if (src.includes("/rsrc.php/")) return false;
            // Exclude known non-listing patterns
            if (src.includes("/icon")) return false;
            if (src.includes("emoji")) return false;
            if (src.includes("/s_")) return false;
            if (src.includes("profile_pic")) return false;
            if (src.includes("safe_image")) return false;
            // Listing photos tend to have longer, content-addressed URLs
            if (src.length < 60) return false;
            return true;
          })
          .slice(0, 20),
    );
    if (images.length > 0) debug["images"] = "img[src](fbcdn_listing_filter)";
  } catch {
    images = [];
  }

  return { title, price, description, seller_name, location, images, is_blocked, selector_debug: debug };
}
