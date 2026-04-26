// Browser extractor: uses Playwright Chromium to render the page and extract content

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../../lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, "../../storage/screenshots");

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

export interface BrowserResult {
  title: string | null;
  visible_text: string | null;
  images: string[];
  screenshot_filename: string | null;
  screenshot_path: string | null;
  page_url: string | null;
  error: string | null;
}

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MAX_IMAGES = 20;

export async function extractWithBrowser(url: string): Promise<BrowserResult> {
  const result: BrowserResult = {
    title: null,
    visible_text: null,
    images: [],
    screenshot_filename: null,
    screenshot_path: null,
    page_url: null,
    error: null,
  };

  let browser = null;
  let context = null;

  try {
    const { chromium } = await import("playwright");

    browser = await chromium.launch({
      headless: true,
      timeout: 45000,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-features=site-per-process",
        "--single-process",
        "--no-zygote",
      ],
    });

    context = await browser.newContext({
      viewport: { width: 1440, height: 2200 },
      userAgent: DESKTOP_UA,
    });

    const page = await context.newPage();

    // Block fonts and stylesheets to speed up load
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["font", "stylesheet"].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    // First attempt: domcontentloaded
    let gotoSucceeded = false;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      gotoSucceeded = true;
    } catch (gotoErr: unknown) {
      const gotoMsg = gotoErr instanceof Error ? gotoErr.message : String(gotoErr);
      logger.warn({ url, error: gotoMsg }, "Browser goto (domcontentloaded) failed — retrying with load");

      // Retry with waitUntil: 'load'
      try {
        await page.goto(url, { waitUntil: "load", timeout: 30000 });
        gotoSucceeded = true;
      } catch (retryErr: unknown) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        logger.warn({ url, error: retryMsg }, "Browser goto retry (load) also failed");
      }
    }

    // Wait for JS rendering regardless of goto outcome (page may still have partial content)
    try {
      await page.waitForTimeout(2500);
    } catch {
      // ignore
    }

    // Collect all data BEFORE any close calls
    result.page_url = page.url();

    try {
      result.title = await page.title();
    } catch {
      result.title = null;
    }

    try {
      const html = await page.content();
      // Strip tags for visible text approximation
      result.visible_text = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 10000);
    } catch {
      result.visible_text = null;
    }

    try {
      result.images = await page.locator("img").evaluateAll(
        (imgs, maxImages) =>
          (imgs as HTMLImageElement[])
            .map((img) => img.src || img.getAttribute("data-src") || "")
            .filter(
              (src) =>
                src &&
                src.startsWith("http") &&
                !src.includes("data:") &&
                !src.includes("icon") &&
                !src.includes("logo") &&
                !src.includes("pixel"),
            )
            .slice(0, maxImages),
        MAX_IMAGES,
      );
    } catch {
      result.images = [];
    }

    try {
      const screenshotFilename = `${uuidv4()}.png`;
      const screenshotPath = path.join(SCREENSHOTS_DIR, screenshotFilename);
      await page.screenshot({ path: screenshotPath, type: "png", fullPage: false });
      result.screenshot_filename = screenshotFilename;
      result.screenshot_path = screenshotPath;
    } catch {
      // Screenshot failure is non-fatal
    }

    if (!gotoSucceeded) {
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
    try {
      await context?.close();
    } catch {}
    try {
      await browser?.close();
    } catch {}
  }

  return result;
}
