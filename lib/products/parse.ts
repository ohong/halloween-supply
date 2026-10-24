import type { Availability } from "../types";

export interface ParsedProduct {
  title: string | null;
  priceCents: number | null;
  currency: string | null;
  images: string[];
  availability: Availability;
  sizes: string[];
  description: string | null;
  /** Which strategy produced the fields. */
  via: "json-ld" | "open-graph" | "claude" | "none";
}

/**
 * Parse a product page: JSON-LD Product first, then Open Graph / product meta tags.
 * Pure and synchronous, so checkout can run it without any model call.
 * Returns via: "none" when neither strategy found a price.
 */
export function parseProduct(html: string, url: string): ParsedProduct {
  void html; void url;
  throw new Error("not implemented");
}

/** Claude extraction fallback for pages without structured data (pipeline only). */
export async function extractProductWithClaude(html: string, url: string): Promise<ParsedProduct> {
  void html; void url;
  throw new Error("not implemented");
}
