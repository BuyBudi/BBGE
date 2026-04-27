// Main extraction pipeline: orchestrates all extractors in platform-preferred order

import { detectPlatform } from "./platformDetector.js";
import { extractMetadata } from "./metadataExtractor.js";
import { extractWithBrowser } from "./browserExtractor.js";
import { extractWithAiVision, isOpenAiConfigured } from "./aiVisionExtractor.js";
import { runFacebookAiRecovery, type FbAiRecoveryResult } from "./facebookAiRecovery.js";
import { detectFacebookLoginWall } from "./facebookLoginWall.js";
import { normalize, type NormalizedListing } from "./normalizer.js";
import { logger } from "../../lib/logger.js";
import type { ExtractionMethod } from "../../config/bbge/platformConfigs.js";

const SCREENSHOT_BASE_URL_ENV = process.env.BBGE_SCREENSHOT_BASE_URL;

function getScreenshotUrl(filename: string | null, baseUrl: string): string | null {
  if (!filename) return null;
  const base = SCREENSHOT_BASE_URL_ENV || baseUrl;
  return `${base}/api/bbge/screenshots/${filename}`;
}

/** Build a synthetic NormalizedListing for the Facebook login wall case */
function buildLoginWallResponse(params: {
  url: string;
  platform: string;
  platform_confidence: number;
  pageUrl: string | null;
  screenshotUrl: string | null;
  loginSignals: string[];
}): NormalizedListing {
  const { url, platform, platform_confidence, pageUrl, screenshotUrl, loginSignals } = params;
  return {
    success: false,
    platform,
    platform_confidence,
    listing_url: url,
    canonical_url: pageUrl,
    title: null,
    price: null,
    description: null,
    seller_name: null,
    seller_profile_url: null,
    location: null,
    category: null,
    condition: null,
    listed_date_or_age: null,
    images: [],
    risk_relevant_observations: [],
    extraction: {
      confidence_score: 0,
      method_used: "facebook_login_wall_detected",
      method_detail: "facebook_login_wall_detected",
      methods_attempted: ["rendered_browser"],
      fields_found: [],
      fields_missing: ["title", "price", "description", "seller_name", "location", "images"],
      warnings: [
        "Facebook redirected the extractor to the login page.",
        "Use Facebook Assisted Capture to supply listing content manually.",
      ],
      selector_debug: {},
      field_sources: {},
      is_blocked: true,
      ai_recovery_used: false,
    },
    evidence: {
      screenshot_url: screenshotUrl,
      html_excerpt: null,
      visible_text_excerpt: null,
    },
    raw: {
      metadata: {},
      browser: {},
      ai: {},
      login_wall: {
        status: "facebook_login_required",
        reason: "Facebook redirected the extractor to the login page.",
        canonical_url: pageUrl ?? "https://www.facebook.com/login",
        next_step: "Use Facebook Assisted Capture or paste listing details manually.",
        signals: loginSignals,
      },
    },
    status: "facebook_login_required",
  };
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

      // Facebook login wall detection — runs BEFORE scoring or AI recovery
      if (detection.platform === "facebook" && browserResult) {
        // Also provide canonical URL from metadata (og:url / <link rel="canonical">)
        // so we can detect login walls that don't change the browser URL.
        const canonicalFromMeta = metadataResult?.canonical_url ?? null;
        const wallCheck = detectFacebookLoginWall({
          pageUrl: browserResult.page_url ?? "",
          canonicalUrl: canonicalFromMeta,
          pageTitle: browserResult.title,
          visibleText: browserResult.visible_text ?? "",
          price: browserResult.price,
          seller_name: browserResult.seller_name,
          description: browserResult.description,
        });

        if (wallCheck.detected) {
          logger.warn(
            { url, signals: wallCheck.signals },
            "BBGE: Facebook login wall detected — returning login_required response",
          );

          const screenshotFilename = browserResult.screenshot_filename;
          const screenshotUrl = getScreenshotUrl(screenshotFilename, requestBaseUrl);

          return buildLoginWallResponse({
            url,
            platform: detection.platform,
            platform_confidence: detection.confidence,
            pageUrl: browserResult.page_url,
            screenshotUrl,
            loginSignals: wallCheck.signals,
          });
        }
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
