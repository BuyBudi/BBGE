// Shared types for platform-specific selector extraction

import type { Page } from "playwright";

export interface SelectorExtractResult {
  title: string | null;
  price: string | null;
  description: string | null;
  seller_name: string | null;
  location: string | null;
  images: string[];
  is_blocked: boolean;
  selector_debug: Record<string, string>;
}

export type PlatformSelectorFn = (
  page: Page,
  html: string,
  visibleText: string,
) => Promise<SelectorExtractResult>;

export function cleanText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : null;
}

export async function trySelectors(
  page: Page,
  selectors: string[],
): Promise<{ value: string | null; matched: string | null }> {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      const count = await el.count();
      if (count === 0) continue;
      const text = await el.innerText({ timeout: 2000 });
      const cleaned = cleanText(text);
      if (cleaned) return { value: cleaned, matched: sel };
    } catch {
      continue;
    }
  }
  return { value: null, matched: null };
}

export async function tryAttrSelectors(
  page: Page,
  selectors: Array<{ sel: string; attr: string }>,
): Promise<{ value: string | null; matched: string | null }> {
  for (const { sel, attr } of selectors) {
    try {
      const el = page.locator(sel).first();
      const count = await el.count();
      if (count === 0) continue;
      const val = await el.getAttribute(attr, { timeout: 2000 });
      const cleaned = cleanText(val);
      if (cleaned) return { value: cleaned, matched: `${sel}[${attr}]` };
    } catch {
      continue;
    }
  }
  return { value: null, matched: null };
}

/** Scan visibleText for a value appearing after any of the given context labels.
 *  Returns the trimmed line/phrase immediately following the label. */
export function extractAfterLabel(
  text: string,
  labels: string[],
  maxLength = 80,
): string | null {
  for (const label of labels) {
    const idx = text.toLowerCase().indexOf(label.toLowerCase());
    if (idx === -1) continue;
    const after = text.slice(idx + label.length, idx + label.length + 200).trim();
    const line = after.split(/[\n|•·]/)[0].trim();
    const cleaned = line.slice(0, maxLength).trim();
    if (cleaned && cleaned.length > 1) return cleaned;
  }
  return null;
}

/** Detect common block/gating signals in visible text */
export function detectBlockedPage(visibleText: string, title: string | null): boolean {
  const BLOCK_PHRASES = [
    "pardon our interruption",
    "please verify yourself",
    "verify you're not a robot",
    "access denied",
    "robot check",
    "captcha",
    "complete the security check",
    "sign in to continue",
    "you've been blocked",
    "page not found",
    "item not found",
    "this listing has ended",
  ];
  const haystack = `${visibleText} ${title ?? ""}`.toLowerCase();
  return BLOCK_PHRASES.some((phrase) => haystack.includes(phrase));
}
