// Browser extractor: Playwright Chromium with humanised behaviour and block retry
// Dispatches to platform-specific selectors for structured field extraction.

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../../lib/logger.js";
import { extractWithPlatformSelector } from "./selectors/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, "../../storage/screenshots");

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

export interface BrowserResult {
  title: string | null;
  price: string | null;
  description: string | null;
  seller_name: string | null;
  location: string | null;
  visible_text: string | null;
  images: string[];
  screenshot_filename: string | null;
  screenshot_path: string | null;
  page_url: string | null;
  selector_debug: Record<string, string>;
  platform_selector_used: string;
  is_blocked: boolean;
  retry_succeeded: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// User agents
// ---------------------------------------------------------------------------

const UA_PRIMARY =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const UA_ALTERNATE =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Throttle: one extraction at a time
// ---------------------------------------------------------------------------

let extractionLock = false;
const lockQueue: Array<() => void> = [];

function acquireLock(): Promise<void> {
  return new Promise((resolve) => {
    if (!extractionLock) {
      extractionLock = true;
      resolve();
    } else {
      lockQueue.push(resolve);
    }
  });
}

function releaseLock(): void {
  if (lockQueue.length > 0) {
    const next = lockQueue.shift()!;
    next();
  } else {
    extractionLock = false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Phrases that reliably indicate a block / gating page */
const BLOCK_PHRASES = [
  "pardon our interruption",
  "please verify yourself",
  "verify you're not a robot",
  "access denied",
  "robot check",
  "captcha",
  "complete the security check",
  "sign in to continue",
  "you've been blocked",
  "temporarily blocked",
];

function isBlockedText(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCK_PHRASES.some((p) => lower.includes(p));
}

/** Strip HTML tags to produce visible text */
function htmlToVisibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 15000);
}

// ---------------------------------------------------------------------------
// Core page load + extraction (single attempt)
// ---------------------------------------------------------------------------

interface AttemptResult {
  title: string | null;
  price: string | null;
  description: string | null;
  seller_name: string | null;
  location: string | null;
  visible_text: string;
  html: string;
  images: string[];
  selector_debug: Record<string, string>;
  page_url: string;
  screenshot_filename: string | null;
  screenshot_path: string | null;
  is_blocked: boolean;
  goto_succeeded: boolean;
}

async function runAttempt(params: {
  chromium: import("playwright").BrowserType;
  url: string;
  platform: string;
  userAgent: string;
  waitAfterLoad: number;
}): Promise<AttemptResult> {
  const { chromium, url, platform, userAgent, waitAfterLoad } = params;

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 2200 },
    locale: "en-AU",
    timezoneId: "Australia/Perth",
    colorScheme: "light",
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    userAgent,
  });

  try {
    const page = await context.newPage();

    // Resource filtering: block fonts, known tracking domains, heavy media
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      const reqUrl = route.request().url();

      // Always block fonts and websockets
      if (type === "font" || type === "websocket" || type === "media") {
        void route.abort();
        return;
      }

      // Block known tracking / ad domains
      const blockDomains = [
        "doubleclick.net",
        "googletagmanager.com",
        "google-analytics.com",
        "googleadservices.com",
        "googlesyndication.com",
        "adnxs.com",
        "criteo.com",
        "quantserve.com",
        "scorecardresearch.com",
        "hotjar.com",
        "clarity.ms",
        "facebook.com/tr",
        "analytics.tiktok.com",
      ];
      if (blockDomains.some((d) => reqUrl.includes(d))) {
        void route.abort();
        return;
      }

      void route.continue();
    });

    // Navigate
    let gotoSucceeded = false;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      gotoSucceeded = true;
    } catch {
      try {
        await page.goto(url, { waitUntil: "load", timeout: 30000 });
        gotoSucceeded = true;
      } catch {}
    }

    // Humanise: random wait, small mouse movement, gentle scroll
    try { await page.waitForTimeout(waitAfterLoad); } catch {}
    try {
      await page.mouse.move(
        randomBetween(200, 600),
        randomBetween(200, 500),
        { steps: randomBetween(5, 12) },
      );
      await page.waitForTimeout(randomBetween(150, 350));
      await page.evaluate(() => window.scrollBy(0, randomBetween(200, 500)));
      await page.waitForTimeout(randomBetween(200, 400));
      await page.evaluate(() => window.scrollBy(0, -randomBetween(50, 150)));
    } catch {}

    // Additional settle wait
    try { await page.waitForTimeout(1200); } catch {}

    // Collect raw content
    const pageUrl = page.url();
    let html = "";
    let visibleText = "";
    let pageTitle: string | null = null;
    try { pageTitle = await page.title(); } catch {}
    try {
      html = await page.content();
      visibleText = htmlToVisibleText(html);
    } catch {}

    // Block detection on visible text + title
    const blockDetected = isBlockedText(`${visibleText} ${pageTitle ?? ""}`);

    // Platform selector extraction
    let price: string | null = null;
    let description: string | null = null;
    let seller_name: string | null = null;
    let location: string | null = null;
    let title: string | null = pageTitle;
    let images: string[] = [];
    let selectorDebug: Record<string, string> = {};

    try {
      const extracted = await extractWithPlatformSelector(page, platform, html, visibleText);
      if (extracted.title) title = extracted.title;
      price = extracted.price;
      description = extracted.description;
      seller_name = extracted.seller_name;
      location = extracted.location;
      selectorDebug = extracted.selector_debug;

      if (extracted.images.length > 0) {
        images = extracted.images;
      } else {
        images = await page.locator("img").evaluateAll(
          (imgs, max) =>
            (imgs as HTMLImageElement[])
              .map((img) => img.src || img.getAttribute("data-src") || "")
              .filter((src) => src && src.startsWith("http") && !src.includes("data:") && !src.includes("icon") && !src.includes("pixel"))
              .slice(0, max),
          20,
        );
      }
    } catch {}

    // Screenshot — always capture
    let screenshotFilename: string | null = null;
    let screenshotPath: string | null = null;
    try {
      screenshotFilename = `${uuidv4()}.png`;
      screenshotPath = path.join(SCREENSHOTS_DIR, screenshotFilename);
      await page.screenshot({ path: screenshotPath, type: "png", fullPage: false });
    } catch {}

    return {
      title,
      price,
      description,
      seller_name,
      location,
      visible_text: visibleText,
      html,
      images,
      selector_debug: selectorDebug,
      page_url: pageUrl,
      screenshot_filename: screenshotFilename,
      screenshot_path: screenshotPath,
      is_blocked: blockDetected,
      goto_succeeded: gotoSucceeded,
    };
  } finally {
    try { await context.close(); } catch {}
    try { await browser.close(); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function extractWithBrowser(url: string, platform: string): Promise<BrowserResult> {
  const result: BrowserResult = {
    title: null,
    price: null,
    description: null,
    seller_name: null,
    location: null,
    visible_text: null,
    images: [],
    screenshot_filename: null,
    screenshot_path: null,
    page_url: null,
    selector_debug: {},
    platform_selector_used: platform === "generic" ? "generic" : platform,
    is_blocked: false,
    retry_succeeded: false,
    error: null,
  };

  await acquireLock();

  try {
    const { chromium } = await import("playwright");

    // ---- First attempt ----
    let attempt = await runAttempt({
      chromium,
      url,
      platform,
      userAgent: UA_PRIMARY,
      waitAfterLoad: randomBetween(1800, 3500),
    });

    if (attempt.is_blocked) {
      logger.warn({ url, platform }, "BBGE: blocked page detected — retrying with alternate UA");

      // ---- Retry with alternate UA and longer wait ----
      try {
        const retry = await runAttempt({
          chromium,
          url,
          platform,
          userAgent: UA_ALTERNATE,
          waitAfterLoad: randomBetween(3500, 5500),
        });

        if (!retry.is_blocked) {
          logger.info({ url, platform }, "BBGE: retry succeeded — block bypassed");
          result.retry_succeeded = true;
          attempt = retry;
        } else {
          logger.warn({ url, platform }, "BBGE: retry attempt still blocked");
          // Use retry screenshot if available (might show the captcha page)
          if (retry.screenshot_filename) {
            attempt.screenshot_filename = retry.screenshot_filename;
            attempt.screenshot_path = retry.screenshot_path;
          }
        }
      } catch (retryErr: unknown) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        logger.warn({ url, platform, error: retryMsg }, "BBGE: retry attempt threw error");
      }
    }

    // Commit attempt result
    result.title = attempt.title;
    result.price = attempt.price;
    result.description = attempt.description;
    result.seller_name = attempt.seller_name;
    result.location = attempt.location;
    result.visible_text = attempt.visible_text;
    result.images = attempt.images;
    result.page_url = attempt.page_url;
    result.selector_debug = attempt.selector_debug;
    result.screenshot_filename = attempt.screenshot_filename;
    result.screenshot_path = attempt.screenshot_path;
    result.is_blocked = attempt.is_blocked;

    if (!attempt.goto_succeeded) {
      result.error = "Rendered browser extraction unavailable.";
    }
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    const isLaunchFailure =
      raw.includes("Failed to launch") ||
      raw.includes("ERR_LAUNCH") ||
      raw.includes("spawn") ||
      raw.includes("ENOENT") ||
      raw.includes("error while loading shared libraries");
    result.error = isLaunchFailure
      ? "Playwright launch failed in current environment."
      : "Rendered browser extraction unavailable.";
    logger.warn({ url, error: raw }, "Browser extraction failed");
  } finally {
    releaseLock();
  }

  return result;
}
