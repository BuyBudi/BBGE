// Metadata extractor: fetches HTML and pulls Open Graph, JSON-LD, and basic meta tags

import * as cheerio from "cheerio";
import { logger } from "../../lib/logger.js";

export interface MetadataResult {
  title: string | null;
  description: string | null;
  image: string | null;
  canonical_url: string | null;
  site_name: string | null;
  json_ld: Record<string, unknown>[];
  raw_html_excerpt: string | null;
  error: string | null;
}

const FETCH_TIMEOUT_MS = 15000;

export async function extractMetadata(url: string): Promise<MetadataResult> {
  const result: MetadataResult = {
    title: null,
    description: null,
    image: null,
    canonical_url: null,
    site_name: null,
    json_ld: [],
    raw_html_excerpt: null,
    error: null,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BBGE/1.0; +https://buybudi.com/bbge)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    }).finally(() => clearTimeout(timer));

    if (!response.ok) {
      result.error = `HTTP ${response.status} ${response.statusText}`;
      return result;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("html")) {
      result.error = `Unexpected content-type: ${contentType}`;
      return result;
    }

    const html = await response.text();
    result.raw_html_excerpt = html.slice(0, 5000);

    const $ = cheerio.load(html);

    // Open Graph tags
    result.title =
      $('meta[property="og:title"]').attr("content") ||
      $("title").text().trim() ||
      null;

    result.description =
      $('meta[property="og:description"]').attr("content") ||
      $('meta[name="description"]').attr("content") ||
      null;

    result.image =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      null;

    result.canonical_url =
      $('meta[property="og:url"]').attr("content") ||
      $('link[rel="canonical"]').attr("href") ||
      null;

    result.site_name = $('meta[property="og:site_name"]').attr("content") || null;

    // JSON-LD structured data
    $('script[type="application/ld+json"]').each((_i, el) => {
      try {
        const raw = $(el).html();
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            result.json_ld.push(...parsed);
          } else {
            result.json_ld.push(parsed);
          }
        }
      } catch {
        // Ignore malformed JSON-LD
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.error = msg;
    logger.warn({ url, error: msg }, "Metadata extraction failed");
  }

  return result;
}
