// Cache the researched merchant photographs unchanged in content; never generate substitute products.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { isDeepStrictEqual } from "node:util";
import { validateSnapshot } from "../../lib/catalog/validate";
import { mapLimit } from "../../lib/sourcing/pool";

const researchDirectory = process.argv[2];
if (!researchDirectory) throw new Error("Pass the reviewed research directory.");
const localImages = new Map<string, string>();
for (const filename of await readdir(researchDirectory)) {
  if (!filename.endsWith(".json") || filename.includes("evidence")) continue;
  const research = JSON.parse(await readFile(path.join(researchDirectory, filename), "utf8"));
  for (const piece of research.pieces ?? []) for (const option of piece.options ?? []) {
    if (typeof option.localImagePath === "string" && path.resolve(option.localImagePath).startsWith(path.resolve(researchDirectory) + path.sep)) localImages.set(option.url, option.localImagePath);
  }
}
await mkdir("public/products/price-tiers", { recursive: true });
type ImageRecord = { productId: string; source: string; image: string; sha256: string; width: number; height: number };
const records: ImageRecord[] = [];
let previousRecords: ImageRecord[] = [];
try { previousRecords = JSON.parse(await readFile("docs/sourcing/price-tiers/images.json", "utf8")); } catch { /* The first research import has no cached photos. */ }
let failures = 0;
for (const filename of (await readdir("data/costumes")).filter((name) => name.endsWith(".json")).sort()) {
  const target = path.join("data/costumes", filename);
  const original = JSON.parse(await readFile(target, "utf8"));
  const snapshot = validateSnapshot(original, false);
  if (!snapshot.provenance.priceTiers) continue;
  const results = await mapLimit(snapshot.products, 4, async (product) => {
    const source = product.sourceImages[0];
    const previous = previousRecords.find((record) => record.productId === product.id && record.source === source);
    if (previous) {
      try {
        const bytes = await readFile(path.join("public", previous.image));
        if (createHash("sha256").update(bytes).digest("hex") === previous.sha256) {
          product.merchantImage = previous.image;
          product.image = previous.image;
          records.push(previous);
          return;
        }
      } catch { /* A missing local copy is fetched again from the merchant. */ }
    }
    const downloaded = localImages.get(product.url);
    let bytes: Uint8Array;
    if (downloaded) bytes = await readFile(downloaded);
    else {
      const response = await fetch(source, { signal: AbortSignal.timeout(25_000), headers: {
        "User-Agent": "Mozilla/5.0", Referer: new URL(product.url).origin + "/", Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      } });
      if (!response.ok) throw new Error(product.id + ": image returned HTTP " + response.status);
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) < 400) throw new Error(product.id + ": merchant photo is too small or unreadable");
    const image = "/products/price-tiers/" + product.id + ".webp";
    const normalized = await sharp(bytes).rotate().resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
    await writeFile(path.join("public", image), normalized);
    product.merchantImage = image;
    product.image = image;
    records.push({ productId: product.id, source, image, sha256: createHash("sha256").update(normalized).digest("hex"), width: metadata.width, height: metadata.height });
  });
  const errors = results.filter((result) => !result.ok);
  for (const result of errors) if (!result.ok) { failures++; console.error(result.error instanceof Error ? result.error.message : "Merchant photo could not be cached"); }
  if (!isDeepStrictEqual(original, snapshot)) await writeFile(target, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(snapshot.costume.slug + ": " + (results.length - errors.length) + "/" + results.length + " merchant photos saved.");
  const researchPath = path.join("docs/sourcing/price-tiers", filename);
  const research = JSON.parse(await readFile(researchPath, "utf8"));
  for (const piece of research.pieces) for (const option of piece.options) {
    const product = snapshot.products.find((product) => product.url === option.url);
    delete option.localImagePath;
    if (product?.merchantImage) option.localMerchantImage = product.merchantImage;
  }
  await writeFile(researchPath, JSON.stringify(research, null, 2) + "\n");
}
await writeFile("docs/sourcing/price-tiers/images.json", JSON.stringify(records, null, 2) + "\n");
if (failures) process.exitCode = 1;
