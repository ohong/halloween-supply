/** Exercise real publication entry points without database access or changing reviewed assets. */
import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { validateDeployedImages, validatePublicationImages } from "../lib/catalog/publication-images";
import { validateSnapshot } from "../lib/catalog/validate";
import { upsertSnapshot } from "../lib/db/catalog";
import { writeCheckpoint, writeSnapshotFile } from "./source/write";
import { costumes } from "../lib/costumes";
import type { CostumeSnapshot } from "../lib/types";

const root = process.cwd();
const slugs = ["cosmic-cowboy", ...costumes.filter(({ slug }) => slug !== "cosmic-cowboy").map(({ slug }) => slug)];
const snapshots: CostumeSnapshot[] = [];
for (const slug of slugs) {
  const snapshot = validateSnapshot(JSON.parse(await readFile(`data/costumes/${slug}.json`, "utf8")));
  await validateDeployedImages(await validatePublicationImages(snapshot));
  snapshots.push(snapshot);
  console.log(`PASS ${slug}: all reviewed merchant photos and costume references decode`);
}

// Negative cases must fail at the image gate, before any database connection is attempted.
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
const scratch = await mkdtemp(path.join(os.tmpdir(), "halloween-publication-"));
try {
  const original = snapshots[0];
  const files = [original.costume.image, ...original.products.flatMap((p) => [p.image, ...(p.cutout ? [p.cutout] : [])])];
  await mkdir(path.join(scratch, "public/products"), { recursive: true });
  for (const file of files) {
    await mkdir(path.dirname(path.join(scratch, "public", file)), { recursive: true });
    await copyFile(path.join(root, "public", file), path.join(scratch, "public", file));
  }
  process.chdir(scratch);

  const reject = async (name: string, snapshot: CostumeSnapshot) => {
    await assert.rejects(() => writeSnapshotFile(snapshot), /Cannot publish/);
    await assert.rejects(() => upsertSnapshot(snapshot), /Cannot publish/);
    await assert.rejects(() => stat("data/costumes"));
    console.log(`PASS ${name}: blocked before bundled catalog or database publication`);
  };
  let draft = structuredClone(original);
  delete draft.products[0].merchantImage;
  await reject("missing merchant photo metadata", draft);
  draft = structuredClone(original);
  draft.products[0].image = draft.products[0].sourceImages[0];
  await reject("unprocessed remote tile", draft);
  draft = structuredClone(original);
  draft.costume.image = "/costumes/cosmic-cowboy.png";
  await reject("editorial photo instead of flat-lay", draft);

  for (const [label, file, replacement] of [
    ["missing tile", original.products[0].image, null],
    ["corrupt tile", original.products[0].image, Buffer.from("not an image")],
    ["blank tile", original.products[0].image, await sharp({ create: { width: 1000, height: 1250, channels: 3, background: "#EFEEEF" } }).jpeg().toBuffer()],
    ["missing flat-lay", original.costume.image, null],
    ["corrupt flat-lay", original.costume.image, Buffer.from("not an image")],
    ["blank flat-lay", original.costume.image, await sharp({ create: { width: 1500, height: 1875, channels: 3, background: "#EFEEEF" } }).jpeg().toBuffer()],
  ] as const) {
    const target = path.join("public", file);
    const bytes = await readFile(target);
    try {
      if (replacement === null) await rm(target);
      else await writeFile(target, replacement);
      await reject(label, original);
    } finally { await writeFile(target, bytes); }
  }

  await writeCheckpoint(draft);
  assert((await stat("data/cache/source-checkpoints/cosmic-cowboy.json")).isFile());
  await assert.rejects(() => stat("data/costumes"));
  console.log("PASS incomplete sourcing checkpoint stays outside the shipped catalog");

  await writeSnapshotFile(original);
  assert.deepEqual(JSON.parse(await readFile("data/costumes/cosmic-cowboy.json", "utf8")), original);
  console.log("PASS complete real catalog publishes atomically to its local snapshot");

  const unpublished = structuredClone(original);
  const product = unpublished.products[0];
  const priorId = product.id;
  product.id = `p-unpublished-${crypto.randomUUID()}`;
  for (const piece of unpublished.pieces) for (const match of piece.matches) if (match.productId === priorId) match.productId = product.id;
  product.image = `/products/price-tiers/${product.id}.webp`;
  product.merchantImage = product.image;
  delete product.cutout;
  await copyFile(path.join("public", original.products[0].image), path.join("public", product.image));
  await validatePublicationImages(unpublished);
  await assert.rejects(() => upsertSnapshot(unpublished), /deploy the complete reviewed images/);
  console.log("PASS complete local images must also be deployed before database publication");

  const photoFile = path.join("public", original.products[0].image);
  const priorBytes = await readFile(photoFile);
  try {
    await writeFile(photoFile, await sharp(priorBytes).rotate(180).webp().toBuffer());
    await validatePublicationImages(original);
    await assert.rejects(() => upsertSnapshot(original), /deploy the complete reviewed images/);
    console.log("PASS valid local images that differ from deployed bytes cannot publish");
  } finally { await writeFile(photoFile, priorBytes); }
} finally {
  process.chdir(root);
  await rm(scratch, { recursive: true, force: true });
}
