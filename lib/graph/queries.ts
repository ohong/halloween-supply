import type {
  Availability,
  Costume,
  CostumeView,
  Merchant,
  MerchantKind,
  Neighborhood,
  Piece,
  PickReason,
  Product,
  ProductOption,
  SharedMerchant,
  SizeKind,
  Tag,
} from "../types";
import {
  buildOption,
  consolidate,
  lowestRank,
  sortCheapest,
  type RawMatch,
  type ShopCandidate,
} from "./assemble";
import { getGraph } from "./client";

// Graph (Cypher) implementations of the catalog functions. The calls in
// lib/catalog.ts wrap these with a timeout and the snapshot fallback.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
type GraphEntity = { properties?: Record<string, any> } | null | undefined;

async function read(query: string, params: Record<string, unknown>): Promise<Row[]> {
  const graph = await getGraph();
  const reply = await graph.roQuery<Row>(query, { params: params as never });
  return (reply.data ?? []) as Row[];
}

const props = (e: GraphEntity): Record<string, any> => e?.properties ?? {};

function toProduct(e: GraphEntity, merchantId: string): Product {
  const p = props(e);
  return {
    id: p.id,
    title: p.title,
    url: p.url,
    priceCents: Number(p.priceCents),
    currency: "USD",
    image: p.image,
    sourceImages: p.sourceImages ?? [],
    availability: p.availability as Availability,
    sizes: p.sizes ?? [],
    merchantId,
    tagSlugs: [],
    description: p.description ?? "",
    checkedAt: p.checkedAt,
  };
}

function toMerchant(e: GraphEntity, neighborhoodId: string | null): Merchant {
  const m = props(e);
  return {
    id: m.id,
    name: m.name,
    domain: m.domain,
    url: m.url,
    kind: m.kind as MerchantKind,
    neighborhoodId,
  };
}

function toRaw(row: Row): RawMatch {
  const pc = props(row.pc);
  const mer = props(row.mer);
  const n = row.n ? props(row.n) : null;
  const regionName: string | null = row.r ? props(row.r).name : null;
  const edge = props(row.m);
  const neighborhood: Neighborhood | null = n
    ? { id: n.id, name: n.name, city: n.city, region: regionName }
    : null;
  return {
    piece: {
      id: pc.id,
      name: pc.name,
      category: pc.category,
      styleNotes: pc.styleNotes ?? "",
      queries: pc.queries ?? [],
      sizeKind: pc.sizeKind as SizeKind,
    },
    costumeSlug: edge.costume,
    rank: Number(edge.rank),
    reason: edge.reason ?? "",
    product: toProduct(row.p, mer.id),
    merchant: toMerchant(row.mer, neighborhood?.id ?? null),
    neighborhood,
    regionName,
    tags: ((row.tags ?? []) as GraphEntity[]).map((t): Tag => ({ slug: props(t).slug, label: props(t).label })),
    nMatches: Number(row.nMatches),
    cheaper: Number(row.cheaper),
  };
}

/**
 * Shared tail: input rows (pc, m, p) from a head MATCH, then
 * count/rank the piece's other matches, walk SOLD_BY -> LOCATED_IN -> IN, collect tags.
 * `filter` is a WHERE body over pc, m, p, mer, n, r.
 */
function optionQuery(head: string, filter = "true", tail = "", carry: string[] = []): string {
  const carried = carry.length ? `${carry.join(", ")}, ` : "";
  return `
    ${head}
    WITH ${carried}pc, m, p
    MATCH (pc)-[m2:MATCHED_BY]->(p2:Product)
    WHERE m2.costume = m.costume
    WITH ${carried}pc, m, p, count(p2) AS nMatches,
         sum(CASE WHEN p2.priceCents < p.priceCents
                   OR (p2.priceCents = p.priceCents AND m2.rank < m.rank) THEN 1 ELSE 0 END) AS cheaper
    MATCH (p)-[:SOLD_BY]->(mer:Merchant)
    OPTIONAL MATCH (mer)-[:LOCATED_IN]->(n:Neighborhood)
    OPTIONAL MATCH (n)-[:IN]->(r:Region)
    WITH ${carried}pc, m, p, nMatches, cheaper, mer, n, r
    WHERE ${filter}
    OPTIONAL MATCH (p)-[:TAGGED]->(t:Tag)
    RETURN ${carried}pc, m, p, mer, n, r, nMatches, cheaper, collect(t) AS tags${tail}`;
}

export async function getCostume(slug: string): Promise<CostumeView | null> {
  // Keep the costume, NEEDS edge, and joined product in one round trip. A cold
  // free-tier graph has no matches and returns null, allowing snapshot fallback.
  const rows = await read(
    optionQuery(
      `MATCH (c:Costume {slug: $slug})-[nd:NEEDS]->(pc:Piece)-[m:MATCHED_BY]->(p:Product)
       WHERE c.status = 'live' AND m.costume = $slug`,
      "true",
      "",
      ["c", "nd"],
    ),
    { slug },
  );
  if (rows.length === 0) return null;
  const c = props(rows[0].c);
  const costume: Costume = {
    slug: c.slug,
    name: c.name,
    description: c.description,
    image: c.image,
    alt: c.alt,
    status: c.status,
  };
  const byPiece = new Map<string, { piece: Piece; raws: RawMatch[] }>();
  for (const row of rows) {
    const raw = toRaw(row);
    const nd = props(row.nd);
    let group = byPiece.get(raw.piece.id);
    if (!group) {
      group = {
        piece: { ...raw.piece, required: nd.required !== false, order: Number(nd.order) },
        raws: [],
      };
      byPiece.set(raw.piece.id, group);
    }
    group.raws.push(raw);
  }
  const pieces: CostumeView["pieces"] = [...byPiece.values()]
    .map(({ piece, raws }) => ({ piece, options: raws.sort((a, b) => a.rank - b.rank).map(buildOption) }))
    .sort((a, b) => a.piece.order - b.piece.order);
  return { costume, pieces };
}

export async function getAlternatives(
  pieceId: string,
  opts: { localOnly?: boolean; maxPriceCents?: number; costumeSlug?: string } = {},
): Promise<ProductOption[]> {
  const rows = await read(
    optionQuery(
      `MATCH (pc:Piece {id: $pieceId})-[m:MATCHED_BY]->(p:Product)
       WHERE $costumeSlug IS NULL OR m.costume = $costumeSlug`,
      `($maxPrice IS NULL OR p.priceCents <= $maxPrice) AND (NOT $localOnly OR r.name = $localRegion)`,
    ),
    {
      pieceId,
      costumeSlug: opts.costumeSlug ?? null,
      maxPrice: opts.maxPriceCents ?? null,
      localOnly: opts.localOnly === true,
      localRegion: "Bay Area",
    },
  );
  return sortCheapest(rows.map((r) => buildOption(toRaw(r))));
}

export async function getMerchantCatalog(merchantId: string, costumeSlug: string): Promise<ProductOption[]> {
  const rows = await read(
    optionQuery(
      `MATCH (:Costume {slug: $costumeSlug})-[nd:NEEDS]->(pc:Piece)-[m:MATCHED_BY]->(p:Product)-[:SOLD_BY]->(:Merchant {id: $merchantId})
       WHERE m.costume = $costumeSlug`,
    ),
    { merchantId, costumeSlug },
  );
  const order = await read(
    `MATCH (:Costume {slug: $costumeSlug})-[nd:NEEDS]->(pc:Piece) RETURN pc.id AS id, nd.order AS ord`,
    { costumeSlug },
  );
  const ord = new Map(order.map((o) => [o.id as string, Number(o.ord)]));
  return rows
    .map(toRaw)
    .sort(
      (a, b) =>
        (ord.get(a.piece.id) ?? 0) - (ord.get(b.piece.id) ?? 0) ||
        a.rank - b.rank ||
        a.product.id.localeCompare(b.product.id),
    )
    .map(buildOption);
}

export async function getFewestShops(productIds: string[]): Promise<SharedMerchant[]> {
  if (productIds.length < 2) return [];
  // Cart products -> the pieces they fill -> every product matched for those pieces ->
  // the merchants that sell them. Merchants covering 2+ pieces are the consolidation candidates.
  const rows = await read(
    `MATCH (pc:Piece)-[:MATCHED_BY]->(cart:Product)
     WHERE cart.id IN $ids
     WITH collect(DISTINCT pc.id) AS pieceIds
     MATCH (pc:Piece)-[m:MATCHED_BY]->(q:Product)-[:SOLD_BY]->(mer:Merchant)
     WHERE pc.id IN pieceIds
     OPTIONAL MATCH (mer)-[:LOCATED_IN]->(n:Neighborhood)
     RETURN mer, n.id AS nid, pc.id AS pieceId, q.id AS productId, min(m.rank) AS rank, q.priceCents AS price`,
    { ids: productIds },
  );
  const candidates: ShopCandidate[] = rows.map((r) => ({
    merchant: toMerchant(r.mer, r.nid ?? null),
    pieceId: r.pieceId,
    productId: r.productId,
    rank: Number(r.rank),
    priceCents: Number(r.price),
  }));
  return consolidate(candidates, productIds);
}

export async function getProductOption(productId: string, pieceId: string): Promise<ProductOption | null> {
  const rows = await read(
    optionQuery(`MATCH (pc:Piece {id: $pieceId})-[m:MATCHED_BY]->(p:Product {id: $productId})`),
    { productId, pieceId },
  );
  const best = lowestRank(rows.map(toRaw));
  return best ? buildOption(best) : null;
}

export async function getPickPath(productId: string, pieceId: string): Promise<PickReason | null> {
  return (await getProductOption(productId, pieceId))?.pick ?? null;
}
