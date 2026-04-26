// Confidence scoring model for BBGE extraction results

export interface ScoredResult {
  confidence_score: number;
  fields_found: string[];
  fields_missing: string[];
}

const FIELD_WEIGHTS: Record<string, number> = {
  title: 20,
  price: 20,
  description: 20,
  seller_name: 15,
  location: 10,
  images: 10,
};

const PLATFORM_BONUS = 5;

export function scoreConfidence(
  data: {
    title: string | null;
    price: string | null;
    description: string | null;
    seller_name: string | null;
    location: string | null;
    images: string[];
  },
  platformDetected: boolean
): ScoredResult {
  const tracked = ["title", "price", "description", "seller_name", "location", "images"];
  let score = 0;
  const fields_found: string[] = [];
  const fields_missing: string[] = [];

  for (const field of tracked) {
    if (field === "images") {
      if (data.images && data.images.length > 0) {
        score += FIELD_WEIGHTS.images;
        fields_found.push("images");
      } else {
        fields_missing.push("images");
      }
    } else {
      const value = data[field as keyof typeof data];
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        score += FIELD_WEIGHTS[field] ?? 0;
        fields_found.push(field);
      } else {
        fields_missing.push(field);
      }
    }
  }

  if (platformDetected) {
    score += PLATFORM_BONUS;
  }

  return {
    confidence_score: Math.min(100, score),
    fields_found,
    fields_missing,
  };
}
