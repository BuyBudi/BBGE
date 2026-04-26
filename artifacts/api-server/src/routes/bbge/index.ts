// BBGE routes: /health and /extract

import { Router, type IRouter, type Request, type Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { runExtractionPipeline } from "../../services/bbge/extractionPipeline.js";
import { isOpenAiConfigured } from "../../services/bbge/aiVisionExtractor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, "../../storage/screenshots");

const router: IRouter = Router();

// Serve screenshots as static files
import express from "express";
router.use("/screenshots", express.static(SCREENSHOTS_DIR));

// GET /bbge/health
router.get("/health", async (_req: Request, res: Response): Promise<void> => {
  let playwrightAvailable = false;
  try {
    await import("playwright");
    playwrightAvailable = true;
  } catch {
    playwrightAvailable = false;
  }

  res.json({
    ok: true,
    service: "BBGE",
    openaiConfigured: isOpenAiConfigured(),
    playwrightAvailable,
  });
});

// POST /bbge/extract
router.post("/extract", async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Missing or invalid 'url' field in request body" });
    return;
  }

  // Validate URL format
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid URL format" });
    return;
  }

  // Only allow http and https
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    res.status(400).json({ error: "Only http and https URLs are allowed" });
    return;
  }

  try {
    const requestBaseUrl = `${req.protocol}://${req.get("host")}`;
    const result = await runExtractionPipeline(url, requestBaseUrl);
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ url, error: msg }, "Extraction pipeline failed");
    res.status(500).json({ error: `Extraction failed: ${msg}` });
  }
});

export default router;
