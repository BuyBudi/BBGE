import { Router, type IRouter, type Request, type Response } from "express";
import healthRouter from "./health";
import bbgeRouter from "./bbge/index";
import { runExtractionPipeline } from "../services/bbge/extractionPipeline.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/bbge", bbgeRouter);

// POST /api/extract — convenience alias for /api/bbge/extract
// Allows external integrations to call /api/extract without the /bbge prefix.
router.post("/extract", async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Missing or invalid 'url' field in request body" });
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid URL format" });
    return;
  }

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
    res.status(500).json({ error: `Extraction failed: ${msg}` });
  }
});

export default router;
