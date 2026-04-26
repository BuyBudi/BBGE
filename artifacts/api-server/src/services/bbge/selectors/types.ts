// Shared types for platform-specific selector extraction

import type { Page } from "playwright";

export interface SelectorExtractResult {
  title: string | null;
  price: string | null;
  description: string | null;
  seller_name: string | null;
  images: string[];
  selector_debug: Record<string, string>;
}

export type PlatformSelectorFn = (page: Page) => Promise<SelectorExtractResult>;

function cleanText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : null;
}

export { cleanText };

export async function trySelectors(page: Page, selectors: string[]): Promise<{ value: string | null; matched: string | null }> {
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

export async function tryAttrSelectors(page: Page, selectors: Array<{ sel: string; attr: string }>): Promise<{ value: string | null; matched: string | null }> {
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
