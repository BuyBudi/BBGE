// eBay platform-specific layered field extractor
// Strategy per field: CSS selectors → visible-text regex → HTML regex fallback

import type { Page } from "playwright";
import type { SelectorExtractResult } from "./types.js";
import {
  trySelectors,
  tryAttrSelectors,
  cleanText,
  extractAfterLabel,
  detectBlockedPage,
} from "./types.js";

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

const PRICE_SELECTORS = [
  "[data-testid='x-price-primary'] span",
  ".x-price-primary span",
  ".x-price-primary",
  "[itemprop='price']",
];

const PRICE_ATTR_SELECTORS = [
  { sel: "meta[property='product:price:amount']", attr: "content" },
  { sel: "meta[property='og:price:amount']", attr: "content" },
  { sel: "[itemprop='price']", attr: "content" },
];

/** AU $1,234 / A$1,234 / AUD $1,234 / $1,234.00 / £1,234 */
const PRICE_REGEX = /(?:AU\s*|A|AUD\s*|NZ\s*|US\s*)?\$[\d,]+(?:\.\d{1,2})?|£[\d,]+(?:\.\d{1,2})?/gi;

/** Lines that are almost certainly NOT the item price */
const PRICE_FALSE_MATCH_WORDS = [
  "postage",
  "shipping",
  "delivery",
  "returns",
  "ebay",
  "sponsored",
  "watching",
  "sold",
  "import",
  "gst",
];

function extractPriceFromText(text: string): string | null {
  const lines = text.split(/[\n.]/);
  for (const line of lines) {
    const low = line.toLowerCase();
    if (PRICE_FALSE_MATCH_WORDS.some((w) => low.includes(w))) continue;
    const matches = line.match(PRICE_REGEX);
    if (matches && matches.length > 0) {
      const candidate = matches[0].trim();
      if (candidate.length > 0) return candidate;
    }
  }
  return null;
}

/** Pull price from eBay's embedded JSON data */
function extractPriceFromHtml(html: string): string | null {
  // eBay embeds price in multiple JSON patterns
  const patterns = [
    /"convertedCurrentPrice"\s*:\s*\{\s*"value"\s*:\s*([\d.]+)/,
    /"currentPrice"\s*:\s*\{\s*"value"\s*:\s*([\d.]+)/,
    /"binPrice"\s*:\s*\{\s*"value"\s*:\s*([\d.]+)/,
    /"price"\s*:\s*\{\s*"value"\s*:\s*([\d.]+)/,
    /"displayPrice"\s*:\s*"([^"]+)"/,
    /\"price\"\s*:\s*\"(\d[\d,.]+)\"/,
  ];
  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m && m[1]) {
      const val = m[1].trim();
      // Convert bare number like "149.99" → "$149.99"
      return val.startsWith("$") || val.startsWith("AU") ? val : `$${val}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Seller
// ---------------------------------------------------------------------------

const SELLER_SELECTORS = [
  "[data-testid='x-sellercard-atf'] a",
  ".x-sellercard-atf__info__about-seller a",
  ".x-sellercard-atf a",
  "[aria-label*='seller' i]",
  "a[href*='/str/']",
  "a[href*='usr/']",
];

const SELLER_CONTEXT_LABELS = [
  "seller information",
  "about this seller",
  "registered as a business seller",
  "seller's other items",
  "visit store",
  "seller:",
];

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

const LOCATION_SELECTORS = [
  "[data-testid*='location' i]",
  "[class*='item-location' i]",
  "[class*='ux-labels-values__values' i]",
  "span[class*='ux-textspans'][class*='SECONDARY']",
];

const LOCATION_CONTEXT_LABELS = [
  "located in:",
  "item location:",
  "postage from:",
  "ships from:",
  "location:",
];

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

const DESCRIPTION_SELECTORS = [
  "[itemprop='description']",
  "#viTabs_0_is",
  ".d-item-description",
  "#desc_div",
  ".ux-layout-section-evo__item--summary",
];

const DESCRIPTION_CONTEXT_LABELS = [
  "about this item",
  "item description",
  "seller's description",
];

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** Prefer large image sizes; filter out thumbnails */
const THUMBNAIL_PATTERNS = ["s-l64", "s-l140", "s-l225", "s-l300", "favicon"];

/** Attempt to up-scale eBay thumbnail URLs to largest available variant */
function normalizeEbayImageUrl(src: string): string {
  return src
    .replace(/s-l\d+(\.\w+)$/, "s-l1600$1")
    .replace(/s-l\d+\./, "s-l1600.");
}

function deduplicateImages(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    // Strip size suffix for dedup key
    const key = url.replace(/s-l\d+/, "s-lX");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(url);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

export async function extractEbay(
  page: Page,
  html: string,
  visibleText: string,
): Promise<SelectorExtractResult> {
  const debug: Record<string, string> = {};

  // ----- BLOCK DETECTION -----
  let pageTitle: string | null = null;
  try { pageTitle = await page.title(); } catch {}
  const is_blocked = detectBlockedPage(visibleText, pageTitle);

  // ----- TITLE -----
  const titleAttr = await tryAttrSelectors(page, [
    { sel: "meta[property='og:title']", attr: "content" },
    { sel: "meta[name='title']", attr: "content" },
  ]);
  const titleEl = titleAttr.value
    ? titleAttr
    : await trySelectors(page, [
        "h1[itemprop='name']",
        ".x-item-title__mainTitle span",
        ".x-item-title__mainTitle",
        "h1.it-ttl",
        "h1",
      ]);
  const title = cleanText(titleEl.value);
  if (titleEl.matched) debug["title"] = titleEl.matched;

  // ----- PRICE -----
  let price: string | null = null;

  // A. CSS selectors
  const priceEl = await trySelectors(page, PRICE_SELECTORS);
  if (priceEl.value) {
    price = cleanText(priceEl.value);
    debug["price"] = priceEl.matched!;
  }

  // B. Meta attribute selectors
  if (!price) {
    const priceMeta = await tryAttrSelectors(page, PRICE_ATTR_SELECTORS);
    if (priceMeta.value) {
      const raw = priceMeta.value.trim();
      price = raw.match(/^\d/) ? `$${raw}` : raw;
      debug["price"] = priceMeta.matched!;
    }
  }

  // C. Visible text regex
  if (!price && !is_blocked) {
    const fromText = extractPriceFromText(visibleText);
    if (fromText) {
      price = fromText;
      debug["price"] = "visible_text_regex";
    }
  }

  // D. HTML JSON fallback
  if (!price && !is_blocked) {
    const fromHtml = extractPriceFromHtml(html);
    if (fromHtml) {
      price = fromHtml;
      debug["price"] = "html_json_regex";
    }
  }

  // ----- SELLER -----
  let seller_name: string | null = null;

  // A. CSS selectors
  const sellerEl = await trySelectors(page, SELLER_SELECTORS);
  if (sellerEl.value) {
    seller_name = cleanText(sellerEl.value);
    debug["seller_name"] = sellerEl.matched!;
  }

  // B. Visible text context parsing
  if (!seller_name && !is_blocked) {
    const fromText = extractAfterLabel(visibleText, SELLER_CONTEXT_LABELS, 60);
    if (fromText && fromText.length < 60) {
      seller_name = cleanText(fromText);
      if (seller_name) debug["seller_name"] = "visible_text_context";
    }
  }

  // ----- LOCATION -----
  let location: string | null = null;

  // A. CSS selectors
  const locationEl = await trySelectors(page, LOCATION_SELECTORS);
  if (locationEl.value) {
    location = cleanText(locationEl.value);
    debug["location"] = locationEl.matched!;
  }

  // B. Visible text context parsing
  if (!location && !is_blocked) {
    const fromText = extractAfterLabel(visibleText, LOCATION_CONTEXT_LABELS, 60);
    if (fromText) {
      location = cleanText(fromText);
      if (location) debug["location"] = "visible_text_context";
    }
  }

  // ----- DESCRIPTION -----
  let description: string | null = null;

  // A. CSS selectors (direct page selectors)
  const descEl = await trySelectors(page, DESCRIPTION_SELECTORS);
  if (descEl.value && descEl.value.length > 10) {
    description = cleanText(descEl.value);
    debug["description"] = descEl.matched!;
  }

  // B. Try iframe content (#desc_ifr / #viTabs_0_is iframes)
  if (!description && !is_blocked) {
    try {
      const iframes = page.frameLocator("#desc_ifr, #viTabs_0_is iframe, iframe[id*='desc']");
      const iframeText = await iframes.locator("body").innerText({ timeout: 3000 });
      const cleaned = cleanText(iframeText);
      if (cleaned && cleaned.length > 10) {
        description = cleaned.slice(0, 2000);
        debug["description"] = "iframe_content";
      }
    } catch {}
  }

  // C. Visible text section after known labels
  if (!description && !is_blocked) {
    const fromText = extractAfterLabel(visibleText, DESCRIPTION_CONTEXT_LABELS, 500);
    if (fromText && fromText.length > 20) {
      description = cleanText(fromText);
      if (description) debug["description"] = "visible_text_context";
    }
  }

  // ----- IMAGES -----
  let images: string[] = [];

  try {
    // A. img[src*="i.ebayimg.com"]
    const imgSrcs = await page.locator("img[src*='i.ebayimg.com']").evaluateAll(
      (imgs) =>
        (imgs as HTMLImageElement[])
          .map((img) => img.src || img.getAttribute("data-src") || "")
          .filter((src) => !!src && src.startsWith("http")),
    );
    debug["images"] = imgSrcs.length > 0 ? "img[src*='i.ebayimg.com']" : "";

    // B. source[srcset*="i.ebayimg.com"] — pull first URL from srcset
    const srcsetUrls = await page.locator("source[srcset*='i.ebayimg.com']").evaluateAll(
      (sources) =>
        (sources as HTMLSourceElement[])
          .map((s) => {
            const srcset = s.getAttribute("srcset") || "";
            // srcset format: "url 1x, url 2x" — take first
            return srcset.split(",")[0].trim().split(" ")[0];
          })
          .filter((src) => !!src && src.startsWith("http")),
    );

    const combined = [...imgSrcs, ...srcsetUrls]
      .filter((src) => !THUMBNAIL_PATTERNS.some((p) => src.includes(p)))
      .map(normalizeEbayImageUrl);

    images = deduplicateImages(combined).slice(0, 12);
    if (images.length > 0) debug["images"] = "img+source[i.ebayimg.com]";
  } catch {
    images = [];
  }

  return { title, price, description, seller_name, location, images, is_blocked, selector_debug: debug };
}
