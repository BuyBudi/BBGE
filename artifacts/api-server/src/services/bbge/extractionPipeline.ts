// Main extraction pipeline: orchestrates all extractors in platform-preferred order

import { detectPlatform } from "./platformDetector.js";
import { extractMetadata } from "./metadataExtractor.js";
import { extractWithBrowser } from "./browserExtractor.js";
import { extractWithAiVision, isOpenAiConfigured } from "./aiVisionExtractor.js";
import { runFacebookAiRecovery, type FbAiRecoveryResult } from "./facebookAiRecovery.js";
import { normalize, type NormalizedListing } from "./normalizer.js";
import { logger } from "../../lib/logger.js";
import type { ExtractionMethod } from "../../config/bbge/platformConfigs.js";

const SCREENSHOT_BASE_URL_ENV = process.env.BBGE_SCREENSHOT_BASE_URL;

function getScreenshotUrl(filename: string | null, baseUrl: string): string | null {
  if (!filename) return null;
  const base = SCREENSHOT_BASE_URL_ENV || baseUrl;
  return `${base}/api/bbge/screenshots/${filename}`;
}

export async function runExtractionPipeline(
  url: string,
  requestBaseUrl: string,
): Promise<NormalizedListing> {
  const detection = detectPlatform(url);
  const methodOrder = detection.platformConfig.methodOrder;

  logger.info(
    { url, platform: detection.platform, methods: methodOrder },
    "Starting BBGE extraction pipeline",
  );

  const methodsAttempted: string[] = [];
  const warnings: string[] = [];

  let metadataResult = null;
  let browserResult = null;
  let aiResult = null;
  let fbAiRecovery: FbAiRecoveryResult | null = null;

  for (const method of methodOrder as ExtractionMethod[]) {
    methodsAttempted.push(method);

    if (method === "metadata") {
      logger.info({ url, method }, "Running metadata extraction");
      metadataResult = await extractMetadata(url);
      if (metadataResult.error) {
        warnings.push(metadataResult.error);
      }
    } else if (method === "rendered_browser") {
      logger.info({ url, method, platform: detection.platform }, "Running browser extraction");
      browserResult = await extractWithBrowser(url, detection.platform);
      if (browserResult.error) {
        warnings.push(browserResult.error);
      }

      // Facebook AI recovery: targeted call to fill missing price/seller/location
      if (
        detection.platform === "facebook" &&
        browserResult &&
        !browserResult.error &&
        !browserResult.is_blocked &&
        isOpenAiConfigured()
      ) {
        const needsRecovery =
          !browserResult.price || !browserResult.seller_name || !browserResult.location;

        if (needsRecovery) {
          logger.info(
            {
              url,
              missing: [
                !browserResult.price && "price",
                !browserResult.seller_name && "seller_name",
                !browserResult.location && "location",
              ].filter(Boolean),
            },
            "Facebook AI recovery triggered for missing fields",
          );

          fbAiRecovery = await runFacebookAiRecovery(
            browserResult.screenshot_path,
            browserResult.visible_text,
          );

          if (fbAiRecovery.error) {
            logger.warn({ error: fbAiRecovery.error }, "Facebook AI recovery encountered an error");
          } else if (!fbAiRecovery.skipped) {
            // Patch browser result with recovered fields (only where still missing)
            if (!browserResult.price && fbAiRecovery.price) {
              browserResult.price = fbAiRecovery.price;
              browserResult.selector_debug["price"] = "fb_ai_recovery";
            }
            if (!browserResult.seller_name && fbAiRecovery.seller_name) {
              browserResult.seller_name = fbAiRecovery.seller_name;
              browserResult.selector_debug["seller_name"] = "fb_ai_recovery";
            }
            if (!browserResult.location && fbAiRecovery.location) {
              browserResult.location = fbAiRecovery.location;
              browserResult.selector_debug["location"] = "fb_ai_recovery";
            }
          }
        }
      }
    } else if (method === "ai_vision") {
      if (!isOpenAiConfigured()) {
        logger.info({ method }, "AI vision skipped: OPENAI_API_KEY not configured");
        const idx = methodsAttempted.lastIndexOf("ai_vision");
        if (idx > -1) {
          methodsAttempted[idx] = "ai_vision_skipped";
        } else {
          methodsAttempted.push("ai_vision_skipped");
        }
        warnings.push("OPENAI_API_KEY is not configured. AI vision extraction has been skipped.");
      } else {
        logger.info({ url, method }, "Running AI vision extraction");
        const screenshotPath = browserResult?.screenshot_path || null;
        const visibleText = browserResult?.visible_text || metadataResult?.raw_html_excerpt || null;
        aiResult = await extractWithAiVision(screenshotPath, visibleText);
        if (aiResult.error) {
          warnings.push(`AI vision extraction encountered an issue: ${aiResult.error}`);
        }
      }
    } else if (method === "ocr_pdf") {
      warnings.push("PDF/OCR fallback not implemented in Phase 1.");
    }
  }

  const screenshotFilename = browserResult?.screenshot_filename || null;
  const screenshotUrl = getScreenshotUrl(screenshotFilename, requestBaseUrl);

  // Determine if AI recovery filled any fields
  const aiRecoveryUsed =
    fbAiRecovery !== null &&
    !fbAiRecovery.skipped &&
    !fbAiRecovery.error &&
    (!!fbAiRecovery.price || !!fbAiRecovery.seller_name || !!fbAiRecovery.location);

  const normalized = normalize({
    url,
    platform: detection.platform,
    platform_confidence: detection.confidence,
    methodsAttempted,
    metadata: metadataResult,
    browser: browserResult,
    ai: aiResult,
    screenshotUrl,
    warnings,
    aiRecoveryUsed,
  });

  logger.info(
    {
      url,
      platform: detection.platform,
      method_used: normalized.extraction.method_used,
      method_detail: normalized.extraction.method_detail,
      confidence: normalized.extraction.confidence_score,
      ai_recovery_used: aiRecoveryUsed,
    },
    "BBGE extraction pipeline complete",
  );

  return normalized;
}
