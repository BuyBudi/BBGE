// Dispatches to the appropriate platform selector based on the detected platform

import type { Page } from "playwright";
import type { SelectorExtractResult } from "./types.js";
import { extractEbay } from "./ebaySelector.js";
import { extractGumtree } from "./gumtreeSelector.js";
import { extractFacebook } from "./facebookSelector.js";
import { extractGeneric } from "./genericSelector.js";

export type { SelectorExtractResult };

export async function extractWithPlatformSelector(
  page: Page,
  platform: string,
): Promise<SelectorExtractResult> {
  switch (platform) {
    case "ebay":
      return extractEbay(page);
    case "gumtree":
      return extractGumtree(page);
    case "facebook":
      return extractFacebook(page);
    default:
      return extractGeneric(page);
  }
}
