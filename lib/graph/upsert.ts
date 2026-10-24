import type { CostumeSnapshot } from "../types";
import { getGraph } from "./client";

// Idempotent write of a whole costume snapshot. Every value goes through query
// parameters; the Cypher text is static.

const INDEXES: Array<[string, string]> = [
  ["Costume", "slug"],
  ["Piece", "id"],
  ["Product", "id"],
  ["Merchant", "id"],
  ["Neighborhood", "id"],
  ["Tag", "slug"],
  ["Region", "name"],
];

export async function ensureIndexes(): Promise<void> {
  const graph = await getGraph();
  for (const [label, prop] of INDEXES) {
    try {
      await graph.createNodeRangeIndex(label, prop);
    } catch (e) {
      if (!/already indexed|already exists/i.test((e as Error).message)) throw e;
    }
  }
}

export interface UpsertCounts {
  costume: number;
  pieces: number;
  products: number;
  merchants: number;
  neighborhoods: number;
  tags: number;
  matches: number;
}

export async function upsertSnapshot(snapshot: CostumeSnapshot): Promise<UpsertCounts> {
  const graph = await getGraph();
  await ensureIndexes();
  const { costume, pieces, products, merchants, neighborhoods, tags } = snapshot;
  const slug = costume.slug;
  const run = (q: string, params: Record<string, unknown>) =>
    graph.query(q, { params: params as never });

  await run(
    `MERGE (c:Costume {slug: $slug})
     SET c.name = $name, c.description = $description, c.image = $image, c.alt = $alt, c.status = $status`,
    { ...costume },
  );

  await run(
    `UNWIND $rows AS row
     MERGE (n:Neighborhood {id: row.id})
     SET n.name = row.name, n.city = row.city`,
    { rows: neighborhoods },
  );
  // Region edges: replace, so a neighborhood that moved or lost its region is corrected.
  await run(
    `UNWIND $rows AS row
     MATCH (n:Neighborhood {id: row.id})-[e:IN]->(r:Region)
     WHERE row.region IS NULL OR r.name <> row.region
     DELETE e`,
    { rows: neighborhoods },
  );
  await run(
    `UNWIND $rows AS row
     WITH row WHERE row.region IS NOT NULL
     MATCH (n:Neighborhood {id: row.id})
     MERGE (r:Region {name: row.region})
     MERGE (n)-[:IN]->(r)`,
    { rows: neighborhoods },
  );

  await run(
    `UNWIND $rows AS row
     MERGE (m:Merchant {id: row.id})
     SET m.name = row.name, m.domain = row.domain, m.url = row.url, m.kind = row.kind`,
    { rows: merchants },
  );
  await run(
    `UNWIND $rows AS row
     MATCH (m:Merchant {id: row.id})-[e:LOCATED_IN]->(n:Neighborhood)
     WHERE row.neighborhoodId IS NULL OR n.id <> row.neighborhoodId
     DELETE e`,
    { rows: merchants },
  );
  await run(
    `UNWIND $rows AS row
     WITH row WHERE row.neighborhoodId IS NOT NULL
     MATCH (m:Merchant {id: row.id}), (n:Neighborhood {id: row.neighborhoodId})
     MERGE (m)-[:LOCATED_IN]->(n)`,
    { rows: merchants },
  );

  await run(
    `UNWIND $rows AS row
     MERGE (t:Tag {slug: row.slug})
     SET t.label = row.label`,
    { rows: tags },
  );

  await run(
    `UNWIND $rows AS row
     MERGE (p:Product {id: row.id})
     SET p.title = row.title, p.url = row.url, p.priceCents = row.priceCents, p.currency = row.currency,
         p.image = row.image, p.sourceImages = row.sourceImages, p.availability = row.availability,
         p.sizes = row.sizes, p.merchantId = row.merchantId, p.tagSlugs = row.tagSlugs,
         p.description = row.description, p.checkedAt = row.checkedAt`,
    { rows: products },
  );
  await run(
    `UNWIND $rows AS row
     MATCH (p:Product {id: row.id})-[e:SOLD_BY]->(m:Merchant)
     WHERE m.id <> row.merchantId
     DELETE e`,
    { rows: products },
  );
  await run(
    `UNWIND $rows AS row
     MATCH (p:Product {id: row.id}), (m:Merchant {id: row.merchantId})
     MERGE (p)-[:SOLD_BY]->(m)`,
    { rows: products },
  );
  await run(
    `UNWIND $rows AS row
     MATCH (p:Product {id: row.id})-[e:TAGGED]->(t:Tag)
     WHERE NOT t.slug IN row.tagSlugs
     DELETE e`,
    { rows: products },
  );
  await run(
    `UNWIND $rows AS row
     MATCH (p:Product {id: row.id})
     UNWIND row.tagSlugs AS slug
     MATCH (t:Tag {slug: slug})
     MERGE (p)-[:TAGGED]->(t)`,
    { rows: products },
  );

  const pieceRows = pieces.map(({ matches, ...piece }) => ({ ...piece, productIds: matches.map((m) => m.productId) }));
  await run(
    `UNWIND $rows AS row
     MERGE (pc:Piece {id: row.id})
     SET pc.name = row.name, pc.category = row.category, pc.styleNotes = row.styleNotes,
         pc.queries = row.queries, pc.sizeKind = row.sizeKind`,
    { rows: pieceRows },
  );
  await run(
    `MATCH (c:Costume {slug: $slug})-[e:NEEDS]->(pc:Piece)
     WHERE NOT pc.id IN $pieceIds
     DELETE e`,
    { slug, pieceIds: pieces.map((p) => p.id) },
  );
  await run(
    `UNWIND $rows AS row
     MATCH (c:Costume {slug: $slug}), (pc:Piece {id: row.id})
     MERGE (c)-[e:NEEDS]->(pc)
     SET e.required = row.required, e.order = row.order`,
    { slug, rows: pieceRows },
  );

  // MATCHED_BY is per costume (a shared piece can rank differently in another costume).
  await run(
    `MATCH (pc:Piece)-[e:MATCHED_BY]->(:Product)
     WHERE e.costume = $slug AND NOT pc.id IN $pieceIds
     DELETE e`,
    { slug, pieceIds: pieces.map((p) => p.id) },
  );
  await run(
    `UNWIND $rows AS row
     MATCH (pc:Piece {id: row.id})-[e:MATCHED_BY]->(p:Product)
     WHERE e.costume = $slug AND NOT p.id IN row.productIds
     DELETE e`,
    { slug, rows: pieceRows },
  );
  const matchRows = pieces.flatMap((pc) =>
    pc.matches.map((m) => ({ pieceId: pc.id, productId: m.productId, rank: m.rank, reason: m.reason })),
  );
  await run(
    `UNWIND $rows AS row
     MATCH (pc:Piece {id: row.pieceId}), (p:Product {id: row.productId})
     MERGE (pc)-[e:MATCHED_BY {costume: $slug}]->(p)
     SET e.rank = row.rank, e.reason = row.reason`,
    { slug, rows: matchRows },
  );

  return {
    costume: 1,
    pieces: pieces.length,
    products: products.length,
    merchants: merchants.length,
    neighborhoods: neighborhoods.length,
    tags: tags.length,
    matches: matchRows.length,
  };
}
