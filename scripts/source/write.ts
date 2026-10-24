// Step 7: assemble the CostumeSnapshot, write data/costumes/<slug>.json, upsert into FalkorDB.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Costume, CostumeSnapshot, Merchant, Neighborhood, Piece, Product, SnapshotPiece, Tag } from "../../lib/types";
import type { RankedPick } from "./rank";

export const snapshotPath = (slug: string) => path.join(process.cwd(), "data", "costumes", `${slug}.json`);

const titleCase = (s: string) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function productIdFor(url: string): string {
  return `p-${createHash("sha1").update(url).digest("hex").slice(0, 10)}`;
}

export interface PiecePicks {
  piece: Piece;
  picks: RankedPick[];
}

export function assembleSnapshot(costume: Costume, perPiece: PiecePicks[], notes: string): CostumeSnapshot {
  const products = new Map<string, Product>();
  const merchants = new Map<string, Merchant>();
  const neighborhoods = new Map<string, Neighborhood>();
  const tags = new Map<string, Tag>();
  const now = new Date().toISOString();

  const pieces: SnapshotPiece[] = perPiece.map(({ piece, picks }) => {
    const matches = picks.map((pk) => {
      const id = productIdFor(pk.candidate.url);
      if (!products.has(id)) {
        const p = pk.candidate.parsed;
        products.set(id, {
          id,
          title: p.title,
          url: pk.candidate.url,
          priceCents: p.priceCents,
          currency: "USD",
          image: p.images[0] ?? "",
          sourceImages: p.images.slice(0, 6),
          availability: p.availability,
          sizes: p.sizes,
          merchantId: pk.merchant.id,
          tagSlugs: pk.tagSlugs,
          description: p.description ?? "",
          checkedAt: now,
        });
      }
      const existing = merchants.get(pk.merchant.id);
      if (!existing || (!existing.neighborhoodId && pk.merchant.neighborhoodId)) merchants.set(pk.merchant.id, pk.merchant);
      if (pk.neighborhood) neighborhoods.set(pk.neighborhood.id, pk.neighborhood);
      for (const t of pk.tagSlugs) if (!tags.has(t)) tags.set(t, { slug: t, label: titleCase(t) });
      return { productId: id, rank: pk.rank, reason: pk.reason };
    });
    return { ...piece, matches };
  });

  return {
    costume,
    pieces,
    products: [...products.values()],
    merchants: [...merchants.values()],
    neighborhoods: [...neighborhoods.values()],
    tags: [...tags.values()],
    provenance: { method: "pipeline", generatedAt: now, notes },
  };
}

/** Drop products/merchants/neighborhoods/tags that no piece references any more. */
export function prune(s: CostumeSnapshot): CostumeSnapshot {
  const productIds = new Set(s.pieces.flatMap((p) => p.matches.map((m) => m.productId)));
  const products = s.products.filter((p) => productIds.has(p.id));
  const merchantIds = new Set(products.map((p) => p.merchantId));
  const merchants = s.merchants.filter((m) => merchantIds.has(m.id));
  const nbIds = new Set(merchants.map((m) => m.neighborhoodId).filter(Boolean));
  const tagSlugs = new Set(products.flatMap((p) => p.tagSlugs));
  return {
    ...s,
    products,
    merchants,
    neighborhoods: s.neighborhoods.filter((n) => nbIds.has(n.id)),
    tags: s.tags.filter((t) => tagSlugs.has(t.slug)),
  };
}

/** Replace the pieces in `partial` inside `existing` (used by --only). */
export function mergeSnapshot(existing: CostumeSnapshot, partial: CostumeSnapshot): CostumeSnapshot {
  const replaced = new Set(partial.pieces.map((p) => p.id));
  const byId = <T extends { id: string }>(a: T[], b: T[]) => [...new Map([...a, ...b].map((x) => [x.id, x])).values()];
  const merged: CostumeSnapshot = {
    ...existing,
    pieces: existing.pieces.map((p) => partial.pieces.find((q) => q.id === p.id) ?? p).concat(partial.pieces.filter((p) => !existing.pieces.some((e) => e.id === p.id))),
    products: byId(existing.products, partial.products),
    merchants: byId(existing.merchants, partial.merchants),
    neighborhoods: byId(existing.neighborhoods, partial.neighborhoods),
    tags: [...new Map([...existing.tags, ...partial.tags].map((t) => [t.slug, t])).values()],
    provenance: { ...existing.provenance, generatedAt: partial.provenance.generatedAt, notes: `${existing.provenance.notes ?? ""} | refreshed ${[...replaced].join(", ")}`.trim() },
  };
  return prune(merged);
}

export async function loadExisting(slug: string): Promise<CostumeSnapshot | null> {
  if (!existsSync(snapshotPath(slug))) return null;
  try {
    return JSON.parse(await readFile(snapshotPath(slug), "utf8")) as CostumeSnapshot;
  } catch {
    return null;
  }
}

export async function writeSnapshotFile(s: CostumeSnapshot): Promise<string> {
  const file = snapshotPath(s.costume.slug);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(s, null, 2)}\n`);
  return file;
}

export async function upsertToGraph(s: CostumeSnapshot, log: (m: string) => void): Promise<void> {
  if (!process.env.FALKORDB_URL) {
    log("FALKORDB_URL is not set: skipped graph upsert (snapshot file was still written).");
    return;
  }
  try {
    const { upsertSnapshot } = await import("../../lib/graph/upsert");
    const counts = await upsertSnapshot(s);
    log(`Upserted to FalkorDB: ${JSON.stringify(counts)}`);
  } catch (e) {
    log(`FalkorDB upsert failed (snapshot file was still written): ${(e as Error).message}`);
  }
}
