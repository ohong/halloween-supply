/** Read-only runtime check: no inference, database writes, or checkout. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import sharp from "sharp";
import { costumes } from "../lib/costumes";
import { mapLimit } from "../lib/sourcing/pool";
import manifest from "../docs/design/model-gallery-image-prompts.json";

const origin = new URL(process.argv[2] ?? "http://localhost:3402").origin;
const expected = costumes.flatMap(({ slug }) => ["male", "female"].map((model) => `/costumes/models/${slug}-${model}.webp`));
assert.equal(manifest.images.length, expected.length);
assert.deepEqual(manifest.images.map(({ file }) => file).sort(), [...expected].sort());
const diskFiles = (await readdir("public/costumes/models")).map((file) => `/costumes/models/${file}`);
assert.deepEqual(diskFiles.sort(), [...expected].sort());

const response = await fetch(origin, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
assert.equal(response.status, 200);
const html = (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
assert(html.includes('aria-label="Model"') && html.includes(">Male</button>") && html.includes(">Female</button>"));
assert.equal((html.match(/class="tile-picture"/g) ?? []).length, costumes.length);
for (const { slug } of costumes) {
  const file = `/costumes/models/${slug}-female.webp`;
  assert(html.includes(file) || html.includes(encodeURIComponent(file)), `${slug}: initial gallery image missing`);
}
console.log(`PASS homepage renders all ${costumes.length} female model images and both model controls`);

const checks = await mapLimit(manifest.images, 5, async (asset) => {
  const local = await readFile(`public${asset.file}`);
  const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(digest(local), asset.sha256, `${asset.file}: reviewed bytes changed`);
  const image = sharp(local, { failOn: "warning" });
  const metadata = await image.metadata();
  const stats = await image.stats();
  assert.equal(metadata.format, "webp");
  assert(metadata.hasAlpha && stats.channels.at(-1)?.min === 0 && stats.channels.at(-1)?.max === 255, `${asset.file}: visible pixels and transparency required`);
  assert.equal(metadata.width, asset.width);
  assert.equal(metadata.height, asset.height);
  assert(Math.max(asset.width, asset.height) === 960);
  const served = await fetch(new URL(asset.file, origin), { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  assert.equal(served.status, 200, `${asset.file}: asset missing`);
  assert(served.headers.get("content-type")?.startsWith("image/"));
  assert.equal(digest(new Uint8Array(await served.arrayBuffer())), asset.sha256, `${asset.file}: served image differs`);
  return asset.file;
});
const failures = checks.flatMap((check, index) => check.ok ? [] : [manifest.images[index].file]);
assert.deepEqual(failures, [], `Invalid or unavailable model images: ${failures.join(", ")}`);
for (const { slug } of costumes) {
  const pair = manifest.images.filter((asset) => asset.slug === slug);
  assert.equal(pair.length, 2);
  assert.notEqual(pair[0].sha256, pair[1].sha256, `${slug}: model versions must be separate images`);
}
console.log(`PASS all ${expected.length} distinct model assets decode, retain transparency, and match served bytes`);

const pages = await mapLimit(costumes, 4, async ({ slug }) => {
  const response = await fetch(new URL(`/costumes/${slug}`, origin), { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 200, slug);
  const html = (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const firstImage = html.slice(html.indexOf('class="carousel-track"')).match(/<img\b[^>]*src="([^"]+)"/i)?.[1];
  assert(firstImage && decodeURIComponent(firstImage).includes(`/costumes/models/${slug}-female.webp`), `${slug}: first slide must use the default female model`);
  return slug;
});
assert(pages.every((page) => page.ok), "A costume page is missing its default model image");
console.log(`PASS all ${costumes.length} costume pages start with a model image`);
