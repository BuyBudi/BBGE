// AI Vision extractor: sends screenshot + text to OpenAI for structured extraction

import fs from "fs";
import { logger } from "../../lib/logger.js";

export interface AiVisionResult {
  title: string | null;
  price: string | null;
  description: string | null;
  seller_name: string | null;
  seller_profile_url: string | null;
  location: string | null;
  category: string | null;
  condition: string | null;
  listed_date_or_age: string | null;
  images_detected: string[];
  risk_relevant_observations: string[];
  error: string | null;
  skipped: boolean;
  skip_reason: string | null;
}

export function isOpenAiConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

const AI_EXTRACTION_PROMPT = `You are a marketplace listing data extractor. Analyze the provided screenshot and/or text and extract structured listing information. 

Return ONLY valid JSON matching this exact schema. Do NOT invent missing data — use null for any field you cannot confidently determine from the actual page content:

{
  "title": string | null,
  "price": string | null,
  "description": string | null,
  "seller_name": string | null,
  "seller_profile_url": string | null,
  "location": string | null,
  "category": string | null,
  "condition": string | null,
  "listed_date_or_age": string | null,
  "images_detected": string[],
  "risk_relevant_observations": string[]
}

Rules:
- title: the listing title/name
- price: include currency symbol if visible
- description: the item description text
- seller_name: the seller's display name
- seller_profile_url: URL to seller's profile if visible
- location: city/region/country if shown
- category: listing category if visible
- condition: new/used/refurbished etc if stated
- listed_date_or_age: when listed or how long ago
- images_detected: any image URLs you can see in the content (empty array if none)
- risk_relevant_observations: any red flags or trust issues (empty array if none)

Return ONLY the JSON object, no explanations or markdown.`;

export async function extractWithAiVision(
  screenshotPath: string | null,
  visibleText: string | null
): Promise<AiVisionResult> {
  const emptyResult: AiVisionResult = {
    title: null,
    price: null,
    description: null,
    seller_name: null,
    seller_profile_url: null,
    location: null,
    category: null,
    condition: null,
    listed_date_or_age: null,
    images_detected: [],
    risk_relevant_observations: [],
    error: null,
    skipped: false,
    skip_reason: null,
  };

  if (!isOpenAiConfigured()) {
    return {
      ...emptyResult,
      skipped: true,
      skip_reason: "OPENAI_API_KEY is not configured",
    };
  }

  if (!screenshotPath && !visibleText) {
    return {
      ...emptyResult,
      skipped: true,
      skip_reason: "No screenshot or text available for AI analysis",
    };
  }

  try {
    const { OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const messages: {
      role: "user";
      content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" } }>;
    }[] = [
      {
        role: "user",
        content: [],
      },
    ];

    // Add screenshot if available
    if (screenshotPath && fs.existsSync(screenshotPath)) {
      const imageData = fs.readFileSync(screenshotPath);
      const base64Image = imageData.toString("base64");
      messages[0].content.push({
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${base64Image}`,
          detail: "low",
        },
      });
    }

    // Add visible text if available
    const textContent = [AI_EXTRACTION_PROMPT];
    if (visibleText) {
      textContent.push(`\n\nVisible page text (first 3000 chars):\n${visibleText.slice(0, 3000)}`);
    }
    messages[0].content.push({ type: "text", text: textContent.join("") });

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      max_tokens: 1000,
      temperature: 0,
    });

    const rawContent = response.choices[0]?.message?.content || "";

    // Parse the JSON response
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ...emptyResult, error: "AI returned no valid JSON" };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      title: parsed.title ?? null,
      price: parsed.price ?? null,
      description: parsed.description ?? null,
      seller_name: parsed.seller_name ?? null,
      seller_profile_url: parsed.seller_profile_url ?? null,
      location: parsed.location ?? null,
      category: parsed.category ?? null,
      condition: parsed.condition ?? null,
      listed_date_or_age: parsed.listed_date_or_age ?? null,
      images_detected: Array.isArray(parsed.images_detected) ? parsed.images_detected : [],
      risk_relevant_observations: Array.isArray(parsed.risk_relevant_observations)
        ? parsed.risk_relevant_observations
        : [],
      error: null,
      skipped: false,
      skip_reason: null,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ error: msg }, "AI vision extraction failed");
    return { ...emptyResult, error: msg };
  }
}
