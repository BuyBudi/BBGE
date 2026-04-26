// Platform-specific extraction method preferences for BBGE

export type ExtractionMethod = "metadata" | "rendered_browser" | "ai_vision" | "ocr_pdf" | "user_assisted";

export interface PlatformConfig {
  name: string;
  domains: string[];
  methodOrder: ExtractionMethod[];
  confidence: number;
}

export const platformConfigs: PlatformConfig[] = [
  {
    name: "facebook_marketplace",
    domains: ["facebook.com", "fb.com", "m.facebook.com"],
    methodOrder: ["rendered_browser", "ai_vision", "metadata"],
    confidence: 95,
  },
  {
    name: "gumtree",
    domains: ["gumtree.com", "gumtree.com.au"],
    methodOrder: ["rendered_browser", "metadata", "ai_vision"],
    confidence: 95,
  },
  {
    name: "ebay",
    domains: ["ebay.com", "ebay.co.uk", "ebay.com.au", "ebay.ca", "ebay.de", "ebay.fr"],
    methodOrder: ["metadata", "rendered_browser", "ai_vision"],
    confidence: 95,
  },
  {
    name: "craigslist",
    domains: ["craigslist.org"],
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
