// Precomputed sourcing pipeline: bun run source <costume-slug> [--dry-run] [--skip-images] [--only=<pieceId>]
//   [--allow-partial] [--force-images]
import { flatlayScale } from "../../lib/products/flatlay";
import { costumes } from "../../lib/costumes";
import { buildFlatlay, applyExistingTiles, processProductImages } from "./images";
import type { Costume, CostumeSnapshot, Piece } from "../../lib/types";
import { decompose } from "./decompose";
import { gatherCandidates } from "./gather";
import { rankPiece } from "./rank";
import { searchPiece } from "./search";
import { assembleSnapshot, loadExisting, mergeSnapshot, prune, type PiecePicks, saveToDatabase, writeSnapshotFile } from "./write";

const REQUIRED_ENV = ["ANTHROPIC_API_KEY", "FIRECRAWL_API_KEY"];

function log(msg: string) {
  console.log(msg);
}

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  let only: string | null = null;
  let slug: string | null = null;
  for (const a of argv) {
    if (a.startsWith("--only=")) only = a.slice("--only=".length);
    else if (a.startsWith("--")) flags.add(a);
    else if (!slug) slug = a;
  }
  return {
    slug,
    only,
    dryRun: flags.has("--dry-run"),
    skipImages: flags.has("--skip-images"),
    allowPartial: flags.has("--allow-partial"),
    forceImages: flags.has("--force-images"),
    unknown: [...flags].filter((f) => !["--dry-run", "--skip-images", "--allow-partial", "--force-images"].includes(f)),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.slug || args.unknown.length) {
    if (args.unknown.length) console.error(`Unknown flag(s): ${args.unknown.join(", ")}`);
    console.error("Usage: bun run source <costume-slug> [--dry-run] [--skip-images] [--only=<pieceId>] [--allow-partial] [--force-images]");
    console.error(`Costumes: ${costumes.map((c) => c.slug).join(", ")}`);
    process.exit(2);
  }
  const source = costumes.find((c) => c.slug === args.slug);
  if (!source) {
    console.error(`Unknown costume "${args.slug}". Costumes: ${costumes.map((c) => c.slug).join(", ")}`);
    process.exit(2);
  }
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing ${missing.join(", ")}. Set them in .env.local (see .env.example); the pipeline needs Anthropic and Firecrawl credentials.`);
    process.exit(1);
  }

  const costume: Costume = {
    slug: source.slug,
    name: source.name,
    description: source.description,
    image: source.image,
    alt: source.alt,
    status: "live",
  };
  const previous = await loadExisting(costume.slug);
  if (previous?.costume.image.startsWith("/products/")) {
    costume.image = previous.costume.image;
    costume.alt = previous.costume.alt;
  }
  log(`Sourcing ${costume.name}${args.dryRun ? " (dry run: nothing is written except the response cache)" : ""}`);

  // 1. decompose
  log("1/6 decompose");
  let pieces: Piece[] = await decompose(source);
  if (args.only) {
    pieces = pieces.filter((p) => p.id === args.only);
    if (!pieces.length) {
      console.error(`--only=${args.only} matches no piece. Ids: ${(await decompose(source)).map((p) => p.id).join(", ")}`);
      process.exit(2);
    }
  }
  for (const p of pieces) log(`  ${p.id}: ${p.queries.join(" | ")}`);

  // 2-5. search, fetch+parse, rank (pieces sequentially; work inside each piece is concurrent)
  const perPiece: PiecePicks[] = [];
  for (const piece of pieces) {
    log(`\n[${piece.id}] 2/6 search`);
    const candidates = await searchPiece(piece, { log, maxCandidates: 6 });
    log(`[${piece.id}] 3-4/6 fetch + parse ${candidates.length} candidates`);
    const merchantPages = candidates.filter((candidate) => candidate.source === "merchant catalog discovery");
    const priced = await gatherCandidates(merchantPages.length ? merchantPages : candidates, { log });
    if (merchantPages.length && priced.length < 3) {
      priced.push(...await gatherCandidates(candidates.filter((candidate) => candidate.source !== "merchant catalog discovery"), { log }));
    }
    log(`[${piece.id}] ${priced.length} usable products; 5/6 rank`);
    const picks = await rankPiece(source, piece, priced);
    if (picks.length < 3) log(`  WARNING: ${piece.id} has only ${picks.length} acceptable matches (need 3)`);
    for (const pk of picks) {
      log(`  #${pk.rank} $${(pk.candidate.parsed.priceCents / 100).toFixed(2)} ${pk.merchant.name}${pk.isLocal ? " [local]" : ""} - ${pk.candidate.parsed.title.slice(0, 70)}\n      ${pk.reason}`);
    }
    perPiece.push({ piece, picks });
    if (!args.dryRun && picks.length === 3) {
      // Preserve completed pieces if a later network or model request fails.
      const partial = assembleSnapshot(costume, [{ piece, picks }], "Sourced from live merchant pages with Firecrawl discovery and public merchant data.");
      const existing = await loadExisting(costume.slug);
      await writeSnapshotFile(existing ? mergeSnapshot(existing, partial) : partial);
      log(`  saved ${piece.id} incrementally`);
    }
  }

  let snapshot: CostumeSnapshot = assembleSnapshot(costume, perPiece, `Firecrawl search and raw merchant pages, with Shopify variant feeds; Claude decomposition and ranking. Only verified in-stock USD variants are included. Bay Area boost +1.5/10.`);
  const short = perPiece.filter((p) => p.picks.length < 3);

  if (args.only) {
    const existing = await loadExisting(costume.slug);
    if (!existing) {
      log(`\n--only needs an existing data/costumes/${costume.slug}.json to merge into; nothing to write.`);
      return;
    }
    snapshot = mergeSnapshot(existing, snapshot);
  } else {
    snapshot = prune(snapshot);
  }

  if (args.dryRun) {
    log(`\nDry run: ${snapshot.products.length} products, ${snapshot.merchants.length} merchants, ${snapshot.neighborhoods.length} neighborhoods, ${snapshot.tags.length} tags. Nothing written.`);
    if (short.length) log(`WARNING: pieces with fewer than 3 matches: ${short.map((p) => p.piece.id).join(", ")}`);
    return;
  }

  // 6. images
  if (args.skipImages) {
    applyExistingTiles(snapshot.products);
  } else {
    log("\n6/6 images (rembg may download a model on first run)");
    const touched = args.only
      ? snapshot.products.filter((p) => perPiece.some((pp) => pp.picks.some((pk) => pk.candidate.url === p.url)))
      : snapshot.products;
    const withCutout = await processProductImages(touched, { force: args.forceImages, log });
    applyExistingTiles(snapshot.products);
    const defaults = snapshot.pieces.map((p) => p.matches.find((m) => m.rank === 0)?.productId).filter((x): x is string => !!x);
    if (await buildFlatlay(costume.slug, defaults, withCutout, log, snapshot.pieces.map(flatlayScale))) {
      snapshot.costume.image = `/products/${costume.slug}-flatlay.jpg`;
      snapshot.costume.alt = `${costume.name}: ${snapshot.pieces.map((piece) => piece.name.toLowerCase()).join(", ")}, arranged on pale grey.`;
    }
  }

  // 7. write
  if (short.length && !args.allowPartial) {
    log(`Incomplete pieces (${short.map((p) => p.piece.id).join(", ")}); kept the prior complete catalog and saved successful pieces. Re-run, or pass --allow-partial for a partial snapshot.`);
    process.exitCode = 1;
    return;
  }
  const file = await writeSnapshotFile(snapshot);
  log(`\nWrote ${file}`);
  await saveToDatabase(snapshot, log);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
