// Assisted Facebook Extractor — extracts listing fields from user-supplied content
// (pasted text, seller text, description, screenshots)
// Uses OpenAI vision+text when available.

import { logger } from "../../lib/logger.js";
import { isOpenAiConfigured } from "./aiVisionExtractor.js";

export interface AssistedFacebookInput {
  listingUrl?: string;
  pastedText?: string;
  sellerText?: string;
  descriptionText?: string;
  screenshots?: string[]; // base64-encoded PNG/JPEG strings
}

export interface AssistedFacebookResult {
  success: boolean;
  status: "ok" | "insufficient_evidence" | "error";
  platform: "facebook";
  listing_url: string | null;
  title: string | null;
  price: string | null;
  description: string | null;
  seller_name: string | null;
  seller_profile_signal: string | null;
  location: string | null;
  category: string | null;
  condition: string | null;
  listed_date_or_age: string | null;
  images: string[];
  risk_relevant_observations: string[];
  extraction: {
    confidence_score: number;
    confidence_band: string;
    method_used: string;
    fields_found: string[];
    fields_missing: string[];
    warnings: string[];
  };
  error: string | null;
}

function bandLabel(score: number): string {
  if (score < 40) return "insufficient";
  if (score < 60) return "limited_prototype_evidence";
  if (score < 80) return "usable_prototype_evidence";
  return "strong_prototype_evidence";
}

function scoreFields(fields: Record<string, string | null | string[]>, hasScreenshots: boolean, hasUrl: boolean): {
  score: number;
  found: string[];
  missing: string[];
} {
  const weights: Record<string, number> = {
    title: 15,
    price: 15,
    description: 20,
    seller_name: 15,
    location: 10,
  };
  const optionalBonus: Record<string, number> = {
    listed_date_or_age: 2,
    category: 2,
    condition: 1,
  };

  let score = 0;
  const found: string[] = [];
  const missing: string[] = [];

  for (const [field, weight] of Object.entries(weights)) {
    const val = fields[field];
    const present = Array.isArray(val) ? val.length > 0 : !!val;
    if (present) { score += weight; found.push(field); }
    else missing.push(field);
  }

  for (const [field, bonus] of Object.entries(optionalBonus)) {
    const val = fields[field];
    if (val) { score += bonus; found.push(field); }
  }

  if (hasScreenshots) score += 15;
  if (hasUrl) score += 5;

  return { score: Math.min(100, score), found, missing };
}

const EXTRACTION_PROMPT = `You are extracting structured listing information from a Facebook Marketplace listing.

The user has manually copied and pasted text from the listing page. Extract all available fields.

Return ONLY a valid JSON object with this exact schema. Use null for any field you cannot confidently determine from the supplied content. Do not invent or guess data.

{
  "title": null,
  "price": null,
  "description": null,
  "seller_name": null,
  "seller_profile_signal": null,
  "location": null,
  "category": null,
  "condition": null,
  "listed_date_or_age": null,
  "risk_relevant_observations": []
}

Rules:
- title: the listing title/item name
- price: include currency symbol (e.g. "$650", "AUD 1,200", "Free")
- description: the item description the seller wrote
- seller_name: the seller's display name or profile name
- seller_profile_signal: any username, profile link text, or ID visible for the seller
- location: suburb, city, or region where the item is located
- category: the listing category if stated
- condition: New / Used / Refurbished / For Parts etc.
- listed_date_or_age: when listed or time ago if shown
- risk_relevant_observations: any red flags or trust issues visible in the content (empty array if none)

Return ONLY the JSON object. No explanations, no markdown.`;

export async function runAssistedFacebookExtraction(
  input: AssistedFacebookInput,
): Promise<AssistedFacebookResult> {
  const empty: AssistedFacebookResult = {
    success: false,
    status: "insufficient_evidence",
    platform: "facebook",
    listing_url: input.listingUrl || null,
    title: null,
    price: null,
    description: null,
    seller_name: null,
    seller_profile_signal: null,
    location: null,
    category: null,
    condition: null,
    listed_date_or_age: null,
    images: [],
    risk_relevant_observations: [],
    extraction: {
      confidence_score: 0,
      confidence_band: "insufficient",
      method_used: "none",
      fields_found: [],
      fields_missing: ["title", "price", "description", "seller_name", "location"],
      warnings: [],
    },
    error: null,
  };

  const hasAnyContent = !!(
    input.pastedText ||
    input.sellerText ||
    input.descriptionText ||
    (input.screenshots && input.screenshots.length > 0)
  );

  if (!hasAnyContent) {
    return {
      ...empty,
      extraction: {
        ...empty.extraction,
        warnings: ["No content was supplied. Paste listing text or upload screenshots to continue."],
      },
    };
  }

  if (!isOpenAiConfigured()) {
    // Heuristic-only extraction from pasted text
    const combinedText = [
      input.pastedText,
      input.sellerText,
      input.descriptionText,
    ].filter(Boolean).join("\n\n");

    const warnings = ["OPENAI_API_KEY is not configured. Using basic text heuristics only — results may be incomplete."];

    const priceMatch = combinedText.match(/(?:AUD|USD|\$)\s*[\d,]+(?:\.\d{1,2})?|\$[\d,]+(?:\.\d{1,2})?|\bFree\b/i);
    const price = priceMatch ? priceMatch[0].trim() : null;

    const lines = combinedText.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const title = lines.find((l) => l.length > 5 && l.length < 100) ?? null;
    const description = input.descriptionText ?? null;
    const seller_name = input.sellerText ? input.sellerText.split(/\n/)[0].trim() : null;

    const fields = { title, price, description, seller_name, location: null };
    const hasScreenshots = !!(input.screenshots && input.screenshots.length > 0);
    const hasUrl = !!input.listingUrl;
    const { score, found, missing } = scoreFields(fields, hasScreenshots, hasUrl);

    return {
      success: score >= 40,
      status: score >= 40 ? "ok" : "insufficient_evidence",
      platform: "facebook",
      listing_url: input.listingUrl || null,
      title,
      price,
      description,
      seller_name,
      seller_profile_signal: null,
      location: null,
      category: null,
      condition: null,
      listed_date_or_age: null,
      images: [],
      risk_relevant_observations: [],
      extraction: {
        confidence_score: score,
        confidence_band: bandLabel(score),
        method_used: "text_heuristics",
        fields_found: found,
        fields_missing: missing,
        warnings,
      },
      error: null,
    };
  }

  // OpenAI extraction
  try {
    const { OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "low" | "high" } }
    > = [];

    // Add screenshots as images
    const screenshots = input.screenshots ?? [];
    for (const screenshot of screenshots.slice(0, 4)) {
      const mimeType = screenshot.startsWith("/9j/") ? "image/jpeg" : "image/png";
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${screenshot}`,
          detail: "low",
        },
      });
    }

    // Build text content
    const textParts: string[] = [EXTRACTION_PROMPT];
    if (input.listingUrl) textParts.push(`\nListing URL: ${input.listingUrl}`);
    if (input.pastedText) textParts.push(`\n\nPasted listing text:\n${input.pastedText.slice(0, 3000)}`);
    if (input.sellerText) textParts.push(`\n\nSeller information:\n${input.sellerText.slice(0, 500)}`);
    if (input.descriptionText) textParts.push(`\n\nItem description:\n${input.descriptionText.slice(0, 1000)}`);

    content.push({ type: "text", text: textParts.join("") });

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content }],
      max_tokens: 800,
      temperature: 0,
    });

    const raw = response.choices[0]?.message?.content ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ...empty, status: "error", error: "AI returned no valid JSON" };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const extractedFields = {
      title: parsed.title ?? null,
      price: parsed.price ?? null,
      description: parsed.description ?? null,
      seller_name: parsed.seller_name ?? null,
      location: parsed.location ?? null,
      listed_date_or_age: parsed.listed_date_or_age ?? null,
      category: parsed.category ?? null,
      condition: parsed.condition ?? null,
    };

    const hasScreenshots = screenshots.length > 0;
    const hasUrl = !!input.listingUrl;
    const { score, found, missing } = scoreFields(extractedFields, hasScreenshots, hasUrl);

    return {
      success: score >= 40,
      status: score >= 40 ? "ok" : "insufficient_evidence",
      platform: "facebook",
      listing_url: input.listingUrl || null,
      title: extractedFields.title,
      price: extractedFields.price,
      description: extractedFields.description,
      seller_name: extractedFields.seller_name,
      seller_profile_signal: parsed.seller_profile_signal ?? null,
      location: extractedFields.location,
      category: extractedFields.category,
      condition: extractedFields.condition,
      listed_date_or_age: extractedFields.listed_date_or_age,
      images: [],
      risk_relevant_observations: Array.isArray(parsed.risk_relevant_observations)
        ? parsed.risk_relevant_observations
        : [],
      extraction: {
        confidence_score: score,
        confidence_band: bandLabel(score),
        method_used: screenshots.length > 0 ? "ai_vision+text" : "ai_text",
        fields_found: found,
        fields_missing: missing,
        warnings: [],
      },
      error: null,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ error: msg }, "Assisted Facebook extraction failed");
    return { ...empty, status: "error", error: msg };
  }
}
