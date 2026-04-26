// Targeted AI recovery for Facebook Marketplace — fills missing price, seller_name, location
// Only invoked for Facebook when one or more of those three fields are absent.

import fs from "fs";
import { logger } from "../../lib/logger.js";
import { isOpenAiConfigured } from "./aiVisionExtractor.js";

export interface FbAiRecoveryResult {
  price: string | null;
  seller_name: string | null;
  location: string | null;
  confidence: number;
  notes: string[];
  skipped: boolean;
  skip_reason: string | null;
  error: string | null;
}

const EMPTY: FbAiRecoveryResult = {
  price: null,
  seller_name: null,
  location: null,
  confidence: 0,
  notes: [],
  skipped: false,
  skip_reason: null,
  error: null,
};

const FB_RECOVERY_PROMPT = `You are analyzing a Facebook Marketplace listing screenshot and text.

Your task is to extract ONLY these three fields:
- price
- seller_name
- location

Return ONLY a JSON object with this exact schema. Do not guess. Only use visible evidence. Return null for anything you cannot confidently determine.

{
  "price": null,
  "seller_name": null,
  "location": null,
  "confidence": 0,
  "notes": []
}

Rules:
- price: the item price shown (e.g. "$650", "AUD 1200", "Free"). Include the currency symbol.
- seller_name: the person's display name who listed the item.
- location: the suburb, city, or region where the item is located.
- confidence: your overall confidence 0–100 in the three fields combined.
- notes: any caveats or observations about the extraction quality.

Return ONLY the JSON object. No explanations, no markdown.`;

export async function runFacebookAiRecovery(
  screenshotPath: string | null,
  visibleText: string | null,
): Promise<FbAiRecoveryResult> {
  if (!isOpenAiConfigured()) {
    return { ...EMPTY, skipped: true, skip_reason: "OPENAI_API_KEY not configured" };
  }

  if (!screenshotPath && !visibleText) {
    return { ...EMPTY, skipped: true, skip_reason: "No screenshot or text available" };
  }

  try {
    const { OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "low" } }
    > = [];

    if (screenshotPath && fs.existsSync(screenshotPath)) {
      const imageData = fs.readFileSync(screenshotPath);
      const base64 = imageData.toString("base64");
      content.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${base64}`, detail: "low" },
      });
    }

    const textParts = [FB_RECOVERY_PROMPT];
    if (visibleText) {
      textParts.push(`\n\nVisible page text (first 2000 chars):\n${visibleText.slice(0, 2000)}`);
    }
    content.push({ type: "text", text: textParts.join("") });

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content }],
      max_tokens: 400,
      temperature: 0,
    });

    const raw = response.choices[0]?.message?.content ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ...EMPTY, error: "AI returned no valid JSON" };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      price: parsed.price ?? null,
      seller_name: parsed.seller_name ?? null,
      location: parsed.location ?? null,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      skipped: false,
      skip_reason: null,
      error: null,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ error: msg }, "Facebook AI recovery failed");
    return { ...EMPTY, error: msg };
  }
}
