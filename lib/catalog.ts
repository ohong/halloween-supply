import "server-only";

import type { CostumeView, PickReason, ProductOption, SharedMerchant } from "./types";

// The one data-access surface for pages, the assistant's server tools and checkout.
// Reads FalkorDB (lib/graph) when FALKORDB_URL is set and reachable, and falls back
// to the committed snapshot in data/costumes/<slug>.json otherwise, so a cold or
// deleted free-tier graph never takes the store down.

/** Where the last read came from; surfaced by /api/health. */
export type CatalogSource = "graph" | "snapshot";

/**
 * The costume page: every piece in NEEDS.order with its default pick (rank 0) and
 * two alternatives, each joined to merchant, neighborhood, tags and pick reason.
 * Returns null for unknown or not-live slugs.
 */
export async function getCostume(slug: string): Promise<CostumeView | null> {
  void slug;
  throw new Error("not implemented");
}

/**
 * Alternatives for a piece, cheapest first.
 * localOnly keeps merchants in the Bay Area region. maxPriceCents is inclusive.
 * Walks Piece -> MATCHED_BY -> Product -> SOLD_BY -> Merchant -> LOCATED_IN -> Neighborhood -> IN -> Region.
 */
export async function getAlternatives(
  pieceId: string,
  opts: { localOnly?: boolean; maxPriceCents?: number; costumeSlug?: string } = {},
): Promise<ProductOption[]> {
  void pieceId; void opts;
  throw new Error("not implemented");
}

/**
 * Everything a merchant sells that matches a piece of the costume.
 * Walks Merchant <- SOLD_BY <- Product <- MATCHED_BY <- Piece <- NEEDS <- Costume.
 */
export async function getMerchantCatalog(merchantId: string, costumeSlug: string): Promise<ProductOption[]> {
  void merchantId; void costumeSlug;
  throw new Error("not implemented");
}

/**
 * "Fewest shops": merchants that carry more than one of the cart's pieces.
 * Given the cart's product ids, returns merchants whose catalog (any MATCHED_BY product
 * for any piece in the cart) covers two or more of those pieces, with the product ids
 * that would consolidate the order. Sorted by coverage, largest first.
 */
export async function getFewestShops(productIds: string[]): Promise<SharedMerchant[]> {
  void productIds;
  throw new Error("not implemented");
}

/** The graph path behind "why this pick" for one product as a match for one piece. */
export async function getPickPath(productId: string, pieceId: string): Promise<PickReason | null> {
  void productId; void pieceId;
  throw new Error("not implemented");
}

/** Look up a single product option by id (checkout uses this to price the cart server-side). */
export async function getProductOption(productId: string, pieceId: string): Promise<ProductOption | null> {
  void productId; void pieceId;
  throw new Error("not implemented");
}
