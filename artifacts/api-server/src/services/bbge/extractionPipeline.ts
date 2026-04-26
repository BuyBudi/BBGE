// Main extraction pipeline: orchestrates all extractors in platform-preferred order

import { detectPlatform } from "./platformDetector.js";
import { extractMetadata } from "./metadataExtractor.js";
import { extractWithBrowser } from "./browserExtractor.js";
import { extractWithAiVision, isOpenAiConfigured } from "./aiVisionExtractor.js";
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
  requestBaseUrl: string
): Promise<NormalizedListing> {
  const detection = detectPlatform(url);
  const methodOrder = detection.platformConfig.methodOrder;

  logger.info(
    { url, platform: detection.platform, methods: methodOrder },
    "Starting BBGE extraction pipeline"
  );

  const methodsAttempted: string[] = [];
  const warnings: string[] = [];

  let metadataResult = null;
  let browserResult = null;
  let aiResult = null;

  for (const method of methodOrder as ExtractionMethod[]) {
    methodsAttempted.push(method);

    if (method === "metadata") {
      logger.info({ url, method }, "Running metadata extraction");
      metadataResult = await extractMetadata(url);
      if (metadataResult.error) {
        warnings.push(metadataResult.error);
      }
    } else if (method === "rendered_browser") {
      logger.info({ url, method }, "Running browser extraction");
      browserResult = await extractWithBrowser(url);
      if (browserResult.error) {
        warnings.push(browserResult.error);
      }
    } else if (method === "ai_vision") {
      if (!isOpenAiConfigured()) {
        logger.info({ method }, "AI vision skipped: OPENAI_API_KEY not configured");
        // Replace the "ai_vision" we already pushed with "ai_vision_skipped"
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
      // Phase 1 placeholder
      warnings.push("PDF/OCR fallback not implemented in Phase 1.");
    }
  }

  const screenshotFilename = browserResult?.screenshot_filename || null;
  const screenshotUrl = getScreenshotUrl(screenshotFilename, requestBaseUrl);

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
  });

  logger.info(
    {
      url,
      platform: detection.platform,
      method_used: normalized.extraction.method_used,
      confidence: normalized.extraction.confidence_score,
    },
    "BBGE extraction pipeline complete"
  );

  return normalized;
}
