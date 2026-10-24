import "server-only";

import { isGraphConfigured, resetGraph } from "./graph/client";
import * as graphImpl from "./graph/queries";
import * as snapshotImpl from "./graph/snapshot";
import type { AlternativeFilters, CostumeView, PickReason, ProductOption, SharedMerchant } from "./types";

// The one data-access surface for pages, the assistant's server tools and checkout.
// Reads FalkorDB (lib/graph) when FALKORDB_URL is set and reachable, and falls back
// to the committed snapshot in data/costumes/<slug>.json otherwise, so a cold or
// deleted free-tier graph never takes the store down.

/** Where the last read came from; surfaced by /api/health. */
export type CatalogSource = "graph" | "snapshot";

const GRAPH_TIMEOUT_MS = 2500;
const GRAPH_RETRY_DELAY_MS = 30_000;

let lastSource: CatalogSource | null = null;
let warned = false;
let retryGraphAfter = 0;

/** Where the most recent read came from (null before the first read). */
export function getCatalogSource(): CatalogSource | null {
  return lastSource;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`graph query timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Graph first when configured; snapshot on any error, timeout or empty answer
 * (an empty answer usually means a cold or wiped free-tier graph).
 */
async function read<T>(
  fromGraph: () => Promise<T>,
  fromSnapshot: () => Promise<T>,
  isEmpty: (v: T) => boolean,
): Promise<T> {
  if (isGraphConfigured() && performance.now() >= retryGraphAfter) {
    try {
      const value = await withTimeout(fromGraph(), GRAPH_TIMEOUT_MS);
      if (!isEmpty(value)) {
        lastSource = "graph";
        warned = false;
        return value;
      }
      // An empty result can be a valid filter. Do not disable graph access.
      warnOnce("graph returned no matching data");
    } catch {
      // A sleeping free-tier database should cost one bounded wait per server,
      // rather than slowing every page and assistant tool while it wakes.
      retryGraphAfter = performance.now() + GRAPH_RETRY_DELAY_MS;
      warnOnce("graph unavailable; retrying in 30 seconds");
      void resetGraph();
    }
  }
  lastSource = "snapshot";
  return fromSnapshot();
}

function warnOnce(reason: string) {
  if (warned) return;
  warned = true;
  console.warn(`[catalog] falling back to snapshot: ${reason}`);
}

/**
 * The costume page: every piece in NEEDS.order with its default pick (rank 0) and
 * two alternatives, each joined to merchant, neighborhood, tags and pick reason.
 * Returns null for unknown, not-live, or incomplete catalogs.
 */
export async function getCostume(slug: string): Promise<CostumeView | null> {
  return read(() => graphImpl.getCostume(slug), () => snapshotImpl.getCostume(slug), (v) => v === null);
}

/**
 * Alternatives for a piece, cheapest first.
 * localOnly keeps merchants in the Bay Area region. maxPriceCents is inclusive.
 * Walks Piece -> MATCHED_BY -> Product -> SOLD_BY -> Merchant -> LOCATED_IN -> Neighborhood -> IN -> Region.
 */
export async function getAlternatives(
  pieceId: string,
  opts: AlternativeFilters = {},
): Promise<ProductOption[]> {
  return read(
    () => graphImpl.getAlternatives(pieceId, opts),
    () => snapshotImpl.getAlternatives(pieceId, opts),
    (v) => v.length === 0,
  );
}

/**
 * Everything a merchant sells that matches a piece of the costume.
 * Walks Merchant <- SOLD_BY <- Product <- MATCHED_BY <- Piece <- NEEDS <- Costume.
 */
export async function getMerchantCatalog(merchantId: string, costumeSlug: string): Promise<ProductOption[]> {
  return read(
    () => graphImpl.getMerchantCatalog(merchantId, costumeSlug),
    () => snapshotImpl.getMerchantCatalog(merchantId, costumeSlug),
    (v) => v.length === 0,
  );
}

/**
 * "Fewest shops": merchants that carry more than one of the cart's pieces.
 * Given the cart's product ids, returns merchants whose catalog (any MATCHED_BY product
 * for any piece in the cart) covers two or more of those pieces, with the product ids
 * that would consolidate the order. Sorted by coverage, largest first.
 */
export async function getFewestShops(productIds: string[]): Promise<SharedMerchant[]> {
  // An empty answer is legitimate here (nothing to consolidate), so only errors fall back.
  return read(() => graphImpl.getFewestShops(productIds), () => snapshotImpl.getFewestShops(productIds), () => false);
}

/** The graph path behind "why this pick" for one product as a match for one piece. */
export async function getPickPath(productId: string, pieceId: string): Promise<PickReason | null> {
  return read(
    () => graphImpl.getPickPath(productId, pieceId),
    () => snapshotImpl.getPickPath(productId, pieceId),
    (v) => v === null,
  );
}

/** Look up a single product option by id (checkout uses this to price the cart server-side). */
export async function getProductOption(productId: string, pieceId: string): Promise<ProductOption | null> {
  return read(
    () => graphImpl.getProductOption(productId, pieceId),
    () => snapshotImpl.getProductOption(productId, pieceId),
    (v) => v === null,
  );
}
