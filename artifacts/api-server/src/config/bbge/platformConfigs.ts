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
    // ai_vision is kept as fallback if Apify is not configured.
    // metadata removed: Facebook returns the login page on server-side HTTP.
    name: "facebook_marketplace",
    domains: ["facebook.com", "fb.com", "m.facebook.com"],
    methodOrder: ["apify", "ai_vision"],
    confidence: 95,
  },
  {
    // Apify (memo23/gumtree-cheerio) is the reliable path.
    // rendered_browser is the fallback if Apify is not configured.
    // metadata removed: Gumtree returns 403 on server-side HTTP.
    name: "gumtree",
    domains: ["gumtree.com.au", "gumtree.com"],
    methodOrder: ["apify", "rendered_browser"],
    confidence: 95,
  },
  {
    // Browser extractor handles Depop at 95% confidence.
    // metadata removed: Depop returns 403 on server-side HTTP.
    name: "depop",
    domains: ["depop.com"],
    methodOrder: ["rendered_browser"],
    confidence: 95,
  },
  {
    // metadata removed: Craigslist returns 403 on server-side HTTP.
    name: "craigslist",
    domains: ["craigslist.org"],
    methodOrder: ["apify", "rendered_browser"],
    confidence: 95,
  },
  {
    // eBay works well via metadata + browser selectors — ai_vision not needed.
    name: "ebay",
    domains: ["ebay.com", "ebay.co.uk", "ebay.com.au", "ebay.ca", "ebay.de", "ebay.fr"],
    methodOrder: ["metadata", "rendered_browser"],
    confidence: 95,
  },
];

export const genericConfig: PlatformConfig = {
  name: "generic",
  domains: [],
  // ai_vision removed from default: avoid spending OpenAI credits on unknown sites.
  methodOrder: ["metadata", "rendered_browser"],
  confidence: 30,
};
