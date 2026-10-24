// Pure helpers shared by the graph and snapshot implementations so both produce
// identical results. No I/O here.

import type {
  Merchant,
  Neighborhood,
  Piece,
  PickPathStep,
  PickReason,
  Product,
  ProductOption,
  SharedMerchant,
  Tag,
} from "../types";

export const LOCAL_REGION = "Bay Area";

/** One (:Piece)-[:MATCHED_BY]->(:Product) edge with everything hanging off the product. */
export interface RawMatch {
  piece: Omit<Piece, "required" | "order">;
  costumeSlug: string;
  rank: number;
  reason: string;
  product: Product;
  merchant: Merchant;
  neighborhood: Neighborhood | null;
  regionName: string | null;
  tags: Tag[];
  /** How many products the piece has in this costume. */
  nMatches: number;
  /** How many of those beat this one on price (ties broken by rank). 0 = cheapest. */
  cheaper: number;
}

export function sortTags(tags: Tag[]): Tag[] {
  return [...tags].sort((a, b) => a.slug.localeCompare(b.slug));
}

export function buildPath(raw: RawMatch): PickPathStep[] {
  const path: PickPathStep[] = [
    { kind: "piece", label: raw.piece.name },
    { kind: "product", label: raw.product.title },
  ];
  for (const t of sortTags(raw.tags)) path.push({ kind: "tag", label: t.label });
  path.push({ kind: "merchant", label: raw.merchant.name });
  if (raw.neighborhood) path.push({ kind: "neighborhood", label: raw.neighborhood.name });
  if (raw.regionName) path.push({ kind: "region", label: raw.regionName });
  if (raw.cheaper === 0 && raw.nMatches > 1) {
    path.push({ kind: "price", label: `Cheapest of ${raw.nMatches} matches` });
  }
  return path;
}

export function buildOption(raw: RawMatch): ProductOption {
  const tags = sortTags(raw.tags);
  const neighborhood = raw.neighborhood ? { ...raw.neighborhood, region: raw.regionName } : null;
  const pick: PickReason = {
    productId: raw.product.id,
    pieceId: raw.piece.id,
    rank: raw.rank,
    reason: raw.reason,
    path: buildPath({ ...raw, tags }),
    isLocal: raw.regionName === LOCAL_REGION,
    isCheapest: raw.cheaper === 0,
  };
  return {
    product: {
      ...raw.product,
      // Preserve the merchant photo. Automated cutouts can remove clothing details.
      image: raw.product.sourceImages.find((src) => /^https?:\/\//i.test(src))?.replace(/^http:/i, "https:") ?? raw.product.image,
      merchantId: raw.merchant.id,
      tagSlugs: tags.map((t) => t.slug),
    },
    merchant: { ...raw.merchant, neighborhoodId: raw.neighborhood?.id ?? null },
    neighborhood,
    tags,
    pick,
  };
}

/** A live piece must retain its default and both distinct swap choices. */
export function hasCompletePicks(options: ProductOption[]): boolean {
  return options.length === 3 &&
    new Set(options.map((option) => option.product.id)).size === 3 &&
    options.every((option, rank) => option.pick.rank === rank);
}

/** Cheapest first, ties by rank then id. Dedupes a product matched by several costumes. */
export function sortCheapest(options: ProductOption[]): ProductOption[] {
  const best = new Map<string, ProductOption>();
  for (const o of options) {
    const cur = best.get(o.product.id);
    if (!cur || o.pick.rank < cur.pick.rank) best.set(o.product.id, o);
  }
  return [...best.values()].sort(
    (a, b) =>
      a.product.priceCents - b.product.priceCents ||
      a.pick.rank - b.pick.rank ||
      a.product.id.localeCompare(b.product.id),
  );
}

/** For getProductOption: the lowest-rank edge between a piece and a product. */
export function lowestRank(raws: RawMatch[]): RawMatch | null {
  return raws.reduce<RawMatch | null>((best, r) => (!best || r.rank < best.rank ? r : best), null);
}

/** A (cart piece x merchant) candidate for fewest-shops consolidation. */
export interface ShopCandidate {
  merchant: Merchant;
  pieceId: string;
  productId: string;
  rank: number;
  priceCents: number;
}

/**
 * Keeps merchants that cover 2+ distinct pieces, picking one product per piece
 * (the cart's own product when this merchant sells it, else best rank, then price).
 */
export function consolidate(candidates: ShopCandidate[], cartProductIds: string[]): SharedMerchant[] {
  const cart = new Set(cartProductIds);
  const byMerchant = new Map<string, { merchant: Merchant; pieces: Map<string, ShopCandidate> }>();
  for (const c of candidates) {
    let m = byMerchant.get(c.merchant.id);
    if (!m) byMerchant.set(c.merchant.id, (m = { merchant: c.merchant, pieces: new Map() }));
    const cur = m.pieces.get(c.pieceId);
    const better = (a: ShopCandidate, b: ShopCandidate) =>
      Number(cart.has(b.productId)) - Number(cart.has(a.productId)) ||
      a.rank - b.rank ||
      a.priceCents - b.priceCents ||
      a.productId.localeCompare(b.productId);
    if (!cur || better(c, cur) < 0) m.pieces.set(c.pieceId, c);
  }
  return [...byMerchant.values()]
    .filter((m) => m.pieces.size >= 2)
    .map((m) => ({
      merchant: m.merchant,
      productIds: [...m.pieces.values()]
        .sort((a, b) => a.pieceId.localeCompare(b.pieceId))
        .map((c) => c.productId),
    }))
    .sort((a, b) => b.productIds.length - a.productIds.length || a.merchant.id.localeCompare(b.merchant.id));
}
