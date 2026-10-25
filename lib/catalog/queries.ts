// Catalog queries shared by the database and the bundled fallback.
import type {
  CostumeSnapshot,
  CostumeView,
  Piece,
  PickReason,
  ProductOption,
  SharedMerchant,
} from "../types";
import {
  buildOption,
  hasCompletePicks,
  consolidate,
  lowestRank,
  sortCheapest,
  type RawMatch,
  type ShopCandidate,
} from "./assemble";



/** Every (piece, product) match edge, fully joined, across the given snapshots. */
function allMatches(snapshots: CostumeSnapshot[]): Array<RawMatch & { pieceFull: Piece }> {
  const out: Array<RawMatch & { pieceFull: Piece }> = [];
  for (const s of snapshots) {
    const products = new Map(s.products.map((p) => [p.id, p]));
    const merchants = new Map(s.merchants.map((m) => [m.id, m]));
    const hoods = new Map(s.neighborhoods.map((n) => [n.id, n]));
    const tags = new Map(s.tags.map((t) => [t.slug, t]));
    for (const sp of s.pieces) {
      const { matches, ...piece } = sp;
      const priced = matches.flatMap((m) => {
        const product = products.get(m.productId);
        return product ? [{ m, product }] : [];
      });
      for (const { m, product } of priced) {
        const merchant = merchants.get(product.merchantId);
        if (!merchant) continue;
        const hood = merchant.neighborhoodId ? hoods.get(merchant.neighborhoodId) ?? null : null;
        const cheaper = priced.filter(
          (o) =>
            o.product.priceCents < product.priceCents ||
            (o.product.priceCents === product.priceCents && o.m.rank < m.rank),
        ).length;
        out.push({
          pieceFull: piece,
          piece: {
            id: piece.id,
            name: piece.name,
            category: piece.category,
            styleNotes: piece.styleNotes,
            queries: piece.queries,
            sizeKind: piece.sizeKind,
          },
          costumeSlug: s.costume.slug,
          rank: m.rank,
          reason: m.reason,
          product,
          merchant,
          neighborhood: hood,
          regionName: hood?.region ?? null,
          tags: product.tagSlugs.flatMap((slug) => {
            const t = tags.get(slug);
            return t ? [t] : [];
          }),
          nMatches: priced.length,
          cheaper,
        });
      }
    }
  }
  return out;
}

export async function getCostume(snapshots: CostumeSnapshot[], slug: string): Promise<CostumeView | null> {
  const s = snapshots.find((x) => x.costume.slug === slug);
  if (!s || s.costume.status !== "live") return null;
  const raws = allMatches([s]);
  const pieces = s.pieces
    .map((sp) => {
      const mine = raws.filter((r) => r.piece.id === sp.id).sort((a, b) => a.rank - b.rank);
      if (mine.length === 0) return null;
      const piece: Piece = { ...mine[0].piece, required: sp.required, order: sp.order };
      return { piece, options: mine.map(buildOption) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.piece.order - b.piece.order);
  if (pieces.length !== s.pieces.length || pieces.some(({ options }) => !hasCompletePicks(options))) return null;
  return { costume: s.costume, pieces };
}

export async function getAlternatives(
  snapshots: CostumeSnapshot[],
  pieceId: string,
  opts: { localOnly?: boolean; maxPriceCents?: number; costumeSlug?: string } = {},
): Promise<ProductOption[]> {
  const options = allMatches(snapshots)
    .filter((r) => r.piece.id === pieceId)
    .filter((r) => !opts.costumeSlug || r.costumeSlug === opts.costumeSlug)
    .filter((r) => opts.maxPriceCents === undefined || r.product.priceCents <= opts.maxPriceCents)
    .filter((r) => !opts.localOnly || r.regionName === "Bay Area")
    .map(buildOption);
  return sortCheapest(options);
}

export async function getMerchantCatalog(snapshots: CostumeSnapshot[], merchantId: string, costumeSlug: string): Promise<ProductOption[]> {
  const s = snapshots.find((x) => x.costume.slug === costumeSlug);
  if (!s) return [];
  const order = new Map(s.pieces.map((p) => [p.id, p.order]));
  return allMatches([s])
    .filter((r) => r.merchant.id === merchantId)
    .sort(
      (a, b) =>
        (order.get(a.piece.id) ?? 0) - (order.get(b.piece.id) ?? 0) ||
        a.rank - b.rank ||
        a.product.id.localeCompare(b.product.id),
    )
    .map(buildOption);
}

export async function getFewestShops(snapshots: CostumeSnapshot[], productIds: string[]): Promise<SharedMerchant[]> {
  if (productIds.length < 2) return [];
  const all = allMatches(snapshots);
  const cart = new Set(productIds);
  const cartPieces = new Set(all.filter((r) => cart.has(r.product.id)).map((r) => r.piece.id));
  const candidates: ShopCandidate[] = all
    .filter((r) => cartPieces.has(r.piece.id))
    .map((r) => ({
      merchant: { ...r.merchant, neighborhoodId: r.neighborhood?.id ?? null },
      pieceId: r.piece.id,
      productId: r.product.id,
      rank: r.rank,
      priceCents: r.product.priceCents,
    }));
  return consolidate(candidates, productIds);
}

export async function getProductOption(snapshots: CostumeSnapshot[], productId: string, pieceId: string): Promise<ProductOption | null> {
  const best = lowestRank(allMatches(snapshots).filter((r) => r.product.id === productId && r.piece.id === pieceId));
  return best ? buildOption(best) : null;
}

export async function getPickPath(snapshots: CostumeSnapshot[], productId: string, pieceId: string): Promise<PickReason | null> {
  return (await getProductOption(snapshots, productId, pieceId))?.pick ?? null;
}
