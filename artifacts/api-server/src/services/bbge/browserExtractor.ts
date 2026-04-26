// Browser extractor: uses Playwright Chromium to render the page and extract content

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../../lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, "../../storage/screenshots");

// Ensure screenshots directory exists
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

const BROWSER_TIMEOUT_MS = 30000;
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
  try {
    // Dynamically import playwright to avoid import errors if not installed
    const { chromium } = await import("playwright");

    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-gpu",
      ],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });

    const page = await context.newPage();

    // Block unnecessary resource types to speed up loading
    await page.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      if (["font", "stylesheet"].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: BROWSER_TIMEOUT_MS,
    });

    // Wait a bit for JS rendering
    await page.waitForTimeout(2000);

    result.page_url = page.url();
    result.title = await page.title();

    // Extract visible text from body
    result.visible_text = await page.evaluate(() => {
      const body = document.body;
      if (!body) return null;
      // Remove script and style elements text
      const clone = body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
      return (clone.textContent || "").replace(/\s+/g, " ").trim().slice(0, 10000);
    });

    // Extract image URLs
    result.images = await page.evaluate((maxImages) => {
      const imgs = Array.from(document.querySelectorAll("img"));
      return imgs
        .map((img) => img.src || img.getAttribute("data-src") || "")
        .filter((src) => src && src.startsWith("http") && !src.includes("data:"))
        .filter((src) => !src.includes("icon") && !src.includes("logo") && !src.includes("pixel"))
        .slice(0, maxImages);
    }, MAX_IMAGES);

    // Capture screenshot
    const screenshotFilename = `${uuidv4()}.png`;
    const screenshotPath = path.join(SCREENSHOTS_DIR, screenshotFilename);

    await page.screenshot({
      path: screenshotPath,
      type: "png",
      fullPage: false,
    });

    result.screenshot_filename = screenshotFilename;
    result.screenshot_path = screenshotPath;

    await context.close();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.error = msg;
    logger.warn({ url, error: msg }, "Browser extraction failed");
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore close errors
      }
    }
  }

  return result;
}
