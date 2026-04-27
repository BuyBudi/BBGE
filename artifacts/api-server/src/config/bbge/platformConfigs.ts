// Platform-specific extraction method preferences for BBGE

export type ExtractionMethod =
  | "metadata"
  | "rendered_browser"
  | "ai_vision"
  | "apify"
  | "ocr_pdf"
  | "user_assisted";

export interface PlatformConfig {
  name: string;
  domains: string[];
  methodOrder: ExtractionMethod[];
  confidence: number;
}

export const platformConfigs: PlatformConfig[] = [
  {
    // Apify first — it handles the login requirement.
    // Login wall detection still runs as a safety net if Apify is not configured.
    name: "facebook_marketplace",
    domains: ["facebook.com", "fb.com", "m.facebook.com"],
    methodOrder: ["apify", "metadata", "ai_vision"],
    confidence: 95,
  },
  {
    name: "gumtree",
    domains: ["gumtree.com.au", "gumtree.com"],
    methodOrder: ["apify", "metadata", "rendered_browser"],
    confidence: 95,
  },
  {
    name: "depop",
    domains: ["depop.com"],
    methodOrder: ["apify", "metadata", "rendered_browser"],
    confidence: 95,
  },
  {
    name: "craigslist",
    domains: ["craigslist.org"],
    methodOrder: ["apify", "metadata", "rendered_browser"],
    confidence: 95,
  },
  {
    // eBay already works well via its own selectors — no Apify needed.
    name: "ebay",
    domains: ["ebay.com", "ebay.co.uk", "ebay.com.au", "ebay.ca", "ebay.de", "ebay.fr"],
    methodOrder: ["metadata", "rendered_browser", "ai_vision"],
    confidence: 95,
  },
];

export const genericConfig: PlatformConfig = {
  name: "generic",
  domains: [],
  methodOrder: ["metadata", "rendered_browser", "ai_vision"],
  confidence: 30,
};
