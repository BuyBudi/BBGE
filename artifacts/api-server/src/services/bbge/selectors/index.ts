// Dispatches to the appropriate platform selector based on the detected platform

import type { Page } from "playwright";
import type { SelectorExtractResult } from "./types.js";
import { extractEbay } from "./ebaySelector.js";
import { extractGumtree } from "./gumtreeSelector.js";
import { extractFacebook } from "./facebookSelector.js";
import { extractDepop } from "./depopSelector.js";
import { extractGeneric } from "./genericSelector.js";

export type { SelectorExtractResult };

export async function extractWithPlatformSelector(
  page: Page,
  platform: string,
  html: string,
  visibleText: string,
): Promise<SelectorExtractResult> {
  switch (platform) {
    case "ebay":
      return extractEbay(page, html, visibleText);
    case "gumtree":
      return extractGumtree(page, html, visibleText);
    case "facebook":
      return extractFacebook(page, html, visibleText);
    case "depop":
      return extractDepop(page, html, visibleText);
    default:
      return extractGeneric(page, html, visibleText);
  }
}
