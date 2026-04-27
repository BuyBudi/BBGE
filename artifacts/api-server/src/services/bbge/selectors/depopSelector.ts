// Depop-specific selector extraction
// Handles seller extraction, image filtering, and review count from visible text.

import type { Page } from "playwright";
import type { SelectorExtractResult } from "./types.js";
import { tryAttrSelectors, cleanText, detectBlockedPage } from "./types.js";

// Only real listing photos live on this CDN. Contentful is navigation/UI.
const DEPOP_PHOTO_HOST = "media-photos.depop.com";

// ─── Seller extraction helpers ────────────────────────────────────────────────

/** Priority 1: "Sold by @username" in og:description */
function sellerFromDescription(desc: string | null): string | null {
  if (!desc) return null;
  const m = desc.match(/Sold by @([A-Za-z0-9_.]+)/i);
  return m ? m[1] : null;
}

/** Priority 2: "username 565 sold · Active" pattern in visible text */
function sellerFromVisibleText(text: string): string | null {
  const m = text.match(/([a-z0-9_.]+)\s+\d+\s+sold\s+[·•]\s+Active/i);
  return m ? m[1] : null;
}

/** Review count: "Active today ( 114 )" in visible text */
function reviewCountFromVisibleText(text: string): string | null {
  const m = text.match(/Active\s+(?:today|recently|\d+\s+\w+\s+ago)\s+\(\s*(\d+)\s*\)/i);
  return m ? m[1] : null;
}

// ─── Main extractor ───────────────────────────────────────────────────────────

export async function extractDepop(
  page: Page,
  _html: string,
  visibleText: string,
): Promise<SelectorExtractResult> {
  const debug: Record<string, string> = {};

  let pageTitle: string | null = null;
  try { pageTitle = await page.title(); } catch {}
  const is_blocked = detectBlockedPage(visibleText, pageTitle);

  // ── Title ──────────────────────────────────────────────────────────────────
  const ogTitle = await tryAttrSelectors(page, [
    { sel: "meta[property='og:title']", attr: "content" },
    { sel: "meta[name='title']", attr: "content" },
  ]);
  let title = cleanText(ogTitle.value);
  if (ogTitle.matched && title) {
    debug["title"] = ogTitle.matched;
  } else if (!title) {
    try {
      const h1 = page.locator("h1").first();
      if ((await h1.count()) > 0) {
        title = cleanText(await h1.innerText({ timeout: 2000 }));
        if (title) debug["title"] = "h1";
      }
    } catch {}
  }

  // ── Price ──────────────────────────────────────────────────────────────────
  // Depop embeds price in og:title: "Vintage Guess Bag | $45.00 | Depop"
  let price: string | null = null;
  if (title) {
    const priceInTitle = title.match(/\$[\d,]+(?:\.\d{1,2})?/);
    if (priceInTitle) {
      price = priceInTitle[0];
      debug["price"] = "og:title:price_regex";
    }
  }
  // Fallback: visible text price pattern
  if (!price) {
    const PRICE_RE = /(?:AUD|USD|CAD|GBP|EUR|NZD)?\s*\$[\d,]+(?:\.\d{1,2})?|\$[\d,]+(?:\.\d{1,2})?/gi;
    const priceMatches = visibleText.match(PRICE_RE);
    if (priceMatches?.[0]) {
      price = priceMatches[0].trim();
      debug["price"] = "regex:price_pattern";
    }
  }

  // ── Description ────────────────────────────────────────────────────────────
  const ogDesc = await tryAttrSelectors(page, [
    { sel: "meta[property='og:description']", attr: "content" },
    { sel: "meta[name='description']", attr: "content" },
  ]);
  const description = cleanText(ogDesc.value);
  if (ogDesc.matched && description) debug["description"] = ogDesc.matched;

  // ── Seller ─────────────────────────────────────────────────────────────────
  let seller_name: string | null =
    sellerFromDescription(description) ??
    sellerFromVisibleText(visibleText);

  if (seller_name) {
    debug["seller_name"] = seller_name.startsWith("@")
      ? "og:description:sold_by"
      : "visible_text:sold_pattern";

    // Store profile URL in selector_debug for transparency
    debug["seller_profile_url"] = `https://www.depop.com/${seller_name}/`;
  }

  // ── Review count ───────────────────────────────────────────────────────────
  const reviewCount = reviewCountFromVisibleText(visibleText);
  if (reviewCount) {
    debug["seller_review_count"] = reviewCount;
  }

  // ── Images ─────────────────────────────────────────────────────────────────
  // Collect all og:image tags (Depop may have multiple)
  let images: string[] = [];
  try {
    const allOgImages = await page
      .locator("meta[property='og:image']")
      .evaluateAll((els) =>
        (els as HTMLMetaElement[]).map((el) => el.content).filter(Boolean),
      );
    if (allOgImages.length > 0) debug["images"] = "meta[property='og:image'][content]";

    // Also pull from page <img> tags
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
          .slice(0, 30),
    );

    const allCandidates = [...allOgImages, ...pageImgs];

    // Filter: only real listing photos from Depop's photo CDN
    const realPhotos = allCandidates.filter((url) => url.includes(DEPOP_PHOTO_HOST));

    if (realPhotos.length > 0) {
      // Deduplicate
      images = [...new Set(realPhotos)].slice(0, 20);
    } else {
      // No CDN-matched photos — fall back to all candidates to avoid returning empty
      images = [...new Set(allCandidates)].slice(0, 20);
    }
  } catch {}

  return {
    title,
    price,
    description,
    seller_name,
    location: null,
    images,
    is_blocked,
    selector_debug: debug,
  };
}
