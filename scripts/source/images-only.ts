// Normalize the already checked catalog without spending search/model credits.
// bun --env-file=.env.local scripts/source/images-only.ts cosmic-cowboy [--force] [--defaults]
import { applyExistingTiles, buildFlatlay, processProductImages } from "./images";
import { loadExisting, upsertToGraph, writeSnapshotFile } from "./write";

const slug = process.argv[2] ?? "cosmic-cowboy";
const snapshot = await loadExisting(slug);
if (!snapshot) throw new Error(`No saved catalog for ${slug}; run the source pipeline first.`);
const selectedIds = new Set(snapshot.pieces.map((p) => p.matches.find((m) => m.rank === 0)?.productId));
const touched = process.argv.includes("--defaults") ? snapshot.products.filter((p) => selectedIds.has(p.id)) : snapshot.products;
const cutouts = await processProductImages(touched, { force: process.argv.includes("--force"), log: console.log });
applyExistingTiles(snapshot.products);
const defaults = snapshot.pieces.map((p) => p.matches.find((m) => m.rank === 0)?.productId).filter((id): id is string => !!id);
if (await buildFlatlay(slug, defaults, cutouts, console.log)) {
  snapshot.costume.image = `/products/${slug}-flatlay.jpg`;
  snapshot.costume.alt = "A composition of the sourced cowboy pieces on pale grey: cowboy hat, a detail of the fringe jacket, trousers, western boots and blue neckerchief.";
}
await writeSnapshotFile(snapshot);
await upsertToGraph(snapshot, console.log);
console.log(`Saved ${snapshot.products.filter((p) => p.image.startsWith("/products/")).length}/${snapshot.products.length} normalized product photos.`);
