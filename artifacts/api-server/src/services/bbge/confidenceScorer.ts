// Confidence scoring model for BBGE extraction results
//
// Score bands (approximate):
//   title only          → ≤ 25
//   + price             → ≤ 55
//   + price + images    → ≤ 70
//   + desc + seller     → ≤ 90
//   all fields present  → 100

export interface ScoredResult {
  confidence_score: number;
  fields_found: string[];
  fields_missing: string[];
}

const FIELD_WEIGHTS: Record<string, number> = {
  title: 25,
  price: 30,
  images: 15,
  description: 15,
  seller_name: 10,
  location: 10,
};

export function scoreConfidence(
  data: {
    title: string | null;
    price: string | null;
    description: string | null;
    seller_name: string | null;
    location: string | null;
    images: string[];
  },
  _platformDetected: boolean,
): ScoredResult {
  const tracked = ["title", "price", "images", "description", "seller_name", "location"];
  let score = 0;
  const fields_found: string[] = [];
  const fields_missing: string[] = [];

  for (const field of tracked) {
    const present =
      field === "images"
        ? data.images && data.images.length > 0
        : data[field as keyof typeof data] !== null &&
          String(data[field as keyof typeof data] ?? "").trim() !== "";

    if (present) {
      score += FIELD_WEIGHTS[field] ?? 0;
      fields_found.push(field);
    } else {
      fields_missing.push(field);
    }
  }

  return {
    confidence_score: Math.min(100, score),
    fields_found,
    fields_missing,
  };
}
