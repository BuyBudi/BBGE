// Detects which marketplace platform a URL belongs to

import { platformConfigs, genericConfig, type PlatformConfig } from "../../config/bbge/platformConfigs.js";

export interface DetectionResult {
  platform: string;
  platformConfig: PlatformConfig;
  confidence: number;
}

export function detectPlatform(url: string): DetectionResult {
  let hostname: string;

  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return {
      platform: "generic",
      platformConfig: genericConfig,
      confidence: 0,
    };
  }

  for (const config of platformConfigs) {
    for (const domain of config.domains) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) {
        return {
          platform: config.name,
          platformConfig: config,
          confidence: config.confidence,
        };
      }
    }
  }

  return {
    platform: "generic",
    platformConfig: genericConfig,
    confidence: genericConfig.confidence,
  };
}
