/** Read-only release checks for every editorial costume, against a running app.
 * bun --env-file=.env.local scripts/verify-full-catalog.ts https://halloween.supply
 * bun scripts/verify-full-catalog.ts http://127.0.0.1:3300 --allow-database-down
 * No checkout, model request, merchant request, or catalog write occurs.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { costumes } from "../lib/costumes";
import { validateSnapshot } from "../lib/catalog/validate";
import * as query from "../lib/catalog/queries";
import type { CostumeSnapshot, CostumeView, ProductOption } from "../lib/types";

type BunRuntime = { plugin(plugin: { name: string; setup(build: { module(name: string, loader: () => unknown): void }): void }): void };
(globalThis as unknown as { Bun: BunRuntime }).Bun.plugin({
  name: "full-catalog-verification-server-modules",
  setup(build) { build.module("server-only", () => ({ exports: {}, loader: "object" })); },
});

type Editorial = (typeof costumes)[number];
type Asset = { transparent: boolean; owners: Set<string> };
type Element = { attributes: Record<string, string>; inner: string };
type HealthCatalog = { costumeSlug: string; source: string; pieces: number; products: number; complete: boolean; pricePointsComplete: boolean };
type Health = {
  status: string;
  catalogSource: string;
  database: { ok: boolean; costumes: number; products: number };
  catalogs: HealthCatalog[];
  coverage: { expectedCostumes: number; shoppableCostumes: number; missingCostumeSlugs: string[] };
};

const base = new URL(process.argv.find((argument) => /^https?:\/\//.test(argument)) ?? "http://127.0.0.1:3300").origin;
const allowDatabaseDown = process.argv.includes("--allow-database-down");
const errors: string[] = [];
const assets = new Map<string, Asset>();
const snapshots = new Map<string, CostumeSnapshot>();
const expectedSlugs = costumes.map(({ slug }) => slug).sort();
let passed = 0;
const pass = (message: string) => { passed++; console.log(`PASS ${message}`); };
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const price = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cents / 100);

async function check<T>(label: string, work: () => T | Promise<T>): Promise<T | undefined> {
  try { return await work(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`${label}: ${message}`);
    console.error(`FAIL ${label}: ${message}`);
  }
}

function decode(value: string): string {
  const entities: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, name: string) => {
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(name[1].toLowerCase() === "x" ? 2 : 1), name[1].toLowerCase() === "x" ? 16 : 10));
    return entities[name.toLowerCase()] ?? entity;
  });
}

const text = (html: string) => decode(html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const rendered = (html: string) => html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
const hasClass = (element: Element, name: string) => (element.attributes.class ?? "").split(/\s+/).includes(name);

function attributes(value: string): Record<string, string> {
  return Object.fromEntries([...value.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((match) => [match[1], decode(match[2] ?? match[3])]));
}

function elements(html: string, tag: string): Element[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "gi"))]
    .map((match) => ({ attributes: attributes(match[1]), inner: match[2] }));
}

function addAsset(file: string, owner: string, transparent = false) {
  const asset = assets.get(file) ?? { transparent, owners: new Set<string>() };
  assert.equal(asset.transparent, transparent, `${file}: conflicting image requirements`);
  asset.owners.add(owner);
  assets.set(file, asset);
}

async function get(route: string) {
  return fetch(new URL(route, base), { signal: AbortSignal.timeout(60_000), cache: "no-store" });
}

async function verifyImage(file: string, { transparent }: Asset) {
  assert(/^\/(?:products|costumes)\/[a-z0-9/-]+\.(?:png|jpg|webp)$/.test(file), "Expected a reviewed local image path");
  const local = await readFile(path.join(process.cwd(), "public", file));
  const image = sharp(local, { failOn: "warning" });
  const metadata = await image.metadata();
  assert(Math.max(metadata.width ?? 0, metadata.height ?? 0) >= (transparent ? 300 : 400) && Math.min(metadata.width ?? 0, metadata.height ?? 0) >= 50, "Image dimensions are too small");
  const stats = await image.stats();
  assert.equal(metadata.format, file.endsWith(".jpg") ? "jpeg" : path.extname(file).slice(1), "Decoded format does not match the reviewed image path");
  if (transparent) {
    assert.equal(metadata.format, "png", "Cutout must be PNG");
    const alpha = stats.channels.at(-1);
    assert(metadata.hasAlpha && alpha && alpha.min === 0 && alpha.max > 0, "Cutout needs transparent background and visible product pixels");
  } else {
    assert(!stats.channels.slice(0, 3).every((channel) => channel.min === channel.max), "Image is blank");
  }
  const response = await get(file);
  assert.equal(response.status, 200, "Public image did not return HTTP 200");
  assert(response.headers.get("content-type")?.startsWith("image/"), "Public response is not an image");
  assert.equal(sha256(new Uint8Array(await response.arrayBuffer())), sha256(local), "Served bytes differ from the reviewed local image");
}

function verifyView(snapshot: CostumeSnapshot, view: CostumeView | null) {
  assert(view, "Catalog query returned no purchasable costume");
  assert.equal(view.pieces.length, snapshot.pieces.length, "A component disappeared from the catalog query");
  for (const { piece, options } of view.pieces) {
    assert.equal(options.length, 3, `${piece.id}: expected three shopping options`);
    assert.deepEqual(options.map(({ pick }) => pick.rank), [0, 1, 2], `${piece.id}: ranks must identify the default and two alternatives`);
    assert.equal(new Set(options.map(({ product }) => product.id)).size, 3, `${piece.id}: product options repeat`);
    assert.equal(new Set(options.map(({ product }) => product.priceCents)).size, 3, `${piece.id}: prices repeat`);
    assert.deepEqual(options.map(({ pick }) => pick.priceTier).sort(), ["$", "$$", "$$$"], `${piece.id}: price tiers are incomplete`);
    assert.equal(options[0].product.availability, "in_stock", `${piece.id}: default must be in stock`);
    assert(options.every(({ product }) => product.availability !== "out_of_stock"), `${piece.id}: an alternative is sold out`);
    for (const { product } of options) {
      assert.equal(product.image, product.merchantImage, `${piece.id}/${product.id}: displayed image must be the actual merchant photograph`);
      assert.equal(product.merchantImage, `/products/price-tiers/${product.id}.webp`, `${piece.id}/${product.id}: missing normalized merchant photograph`);
      assert(product.sourceImages.length > 0, `${piece.id}/${product.id}: missing merchant source photograph`);
      assert(product.sourcing?.method === "built-in-web" && product.sourcing.url, `${piece.id}/${product.id}: missing direct research evidence`);
      addAsset(product.image, `${snapshot.costume.slug}/${piece.id}/${product.id}`);
      if (product.cutout) addAsset(product.cutout, `${snapshot.costume.slug}/${product.id}`, true);
    }
  }
}

async function verifyPage(editorial: Editorial, snapshot?: CostumeSnapshot) {
  const response = await get(`/costumes/${editorial.slug}`);
  assert.equal(response.status, 200, "Costume page did not return HTTP 200");
  assert(response.headers.get("content-type")?.includes("text/html"), "Costume page is not HTML");
  const html = rendered(await response.text());
  assert(!elements(html, "p").some((element) => hasClass(element, "preview-status")), "Page fell back to a Style guide");
  assert(!/No available pick\.|Nothing to buy\./.test(text(html)), "Page contains a shopping dead end");
  assert(elements(html, "button").some((button) => text(button.inner).startsWith("Add whole costume")), "Missing whole-costume shopping control");
  assert(html.includes(editorial.image) || html.includes(encodeURIComponent(editorial.image)), "Generated complete-look reference is missing");
  if (!snapshot) return;
  const view = await query.getCostume([snapshot], editorial.slug);
  assert(view, "No local view is available for page comparison");
  const rows = elements(html, "li").filter((element) => hasClass(element, "piece"));
  assert.equal(rows.length, view.pieces.length, "Rendered component count differs from the saved catalog");
  for (const { piece, options } of view.pieces) {
    const row = rows.find((candidate) => elements(candidate.inner, "h2").some((heading) => text(heading.inner) === piece.name));
    assert(row, `${piece.id}: no shopping row`);
    const chosen = options[0];
    const link = elements(row.inner, "a").find((candidate) => candidate.attributes.href === chosen.product.url);
    assert(link, `${piece.id}: missing exact default merchant purchase URL`);
    assert.equal(link.attributes["aria-label"], `${chosen.product.title} at ${chosen.merchant.name}`, `${piece.id}: default merchant/product is incorrect`);
    assert.equal(link.attributes.target, "_blank", `${piece.id}: merchant link must open a separate tab`);
    assert([...link.inner.matchAll(/<img\b([^>]*)>/gi)].some((match) => attributes(match[1]).src === chosen.product.merchantImage), `${piece.id}: default merchant photo is not displayed`);
    assert(elements(row.inner, "p").some((element) => hasClass(element, "piece-title") && text(element.inner) === chosen.product.title), `${piece.id}: default product title is missing`);
    assert(elements(row.inner, "p").some((element) => hasClass(element, "piece-merchant") && text(element.inner).includes(chosen.merchant.name)), `${piece.id}: default merchant name is missing`);
    const group = elements(row.inner, "div").find((element) => element.attributes["aria-label"] === `Price points for ${piece.name}`);
    assert(group, `${piece.id}: no price-point controls`);
    const buttons = elements(group.inner, "button");
    const ordered = [...options].sort((a, b) => a.product.priceCents - b.product.priceCents);
    assert.deepEqual(buttons.map((button) => text(button.inner)), ordered.map((option) => `${option.pick.priceTier} ${price(option.product.priceCents)}`), `${piece.id}: rendered price points differ from the catalog`);
    assert.equal(buttons.filter((button) => button.attributes["aria-pressed"] === "true").length, 1, `${piece.id}: a single default price point must be selected`);
    assert(elements(row.inner, "button").some((button) => text(button.inner) === "Add to cart"), `${piece.id}: no cart control`);
    assert(elements(row.inner, "button").some((button) => button.attributes["aria-label"] === `Change ${piece.name}`), `${piece.id}: no alternative control`);
    assert(elements(row.inner, "summary").some((summary) => text(summary.inner) === "Why this pick"), `${piece.id}: no pick explanation`);
  }
  pass(`${editorial.slug}: ${view.pieces.length} shopping rows, three price points each, real default merchant links and photographs`);
}

const optionIdentity = (options: ProductOption[]) => options.map(({ product, merchant, pick }) => ({ product, merchant, pick }));

async function verifySources(health?: Health) {
  const beforeBundleErrors = errors.length;
  const { SNAPSHOTS } = await import("../lib/catalog/fallback");
  await check("bundled coverage", () => assert.deepEqual(SNAPSHOTS.map(({ costume }) => costume.slug).sort(), expectedSlugs, "Bundled catalogs must cover every editorial costume exactly once"));
  for (const snapshot of SNAPSHOTS) await check(`${snapshot.costume.slug} bundled data`, () => {
    assert.deepEqual(validateSnapshot(snapshot), snapshots.get(snapshot.costume.slug), "Bundled catalog differs from the reviewed disk snapshot");
  });

  const savedDatabaseUrl = process.env.TURSO_DATABASE_URL;
  const savedDatabaseToken = process.env.TURSO_AUTH_TOKEN;
  const catalog = await import("../lib/catalog");
  try {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    await check("database-free source", async () => assert.equal((await catalog.readCatalogs()).source, "snapshot"));
    for (const snapshot of snapshots.values()) await check(`${snapshot.costume.slug} bundled runtime`, async () => {
      assert.deepEqual(await catalog.getCostume(snapshot.costume.slug), await query.getCostume([snapshot], snapshot.costume.slug), "Database-free runtime differs from the reviewed catalog");
    });
    await check("unknown costume", async () => assert.equal(await catalog.getCostume("unknown-costume"), null));
  } finally {
    if (savedDatabaseUrl !== undefined) process.env.TURSO_DATABASE_URL = savedDatabaseUrl;
    if (savedDatabaseToken !== undefined) process.env.TURSO_AUTH_TOKEN = savedDatabaseToken;
  }
  if (errors.length === beforeBundleErrors) pass(`${expectedSlugs.length} bundled catalogs match disk snapshots and work without database credentials`);
  if (allowDatabaseDown && health?.database.ok === false && health.catalogSource === "snapshot") {
    console.warn("WARN SKIP Turso parity: server explicitly reports snapshot fallback (--allow-database-down). No database readiness claim is made.");
    return;
  }
  await check("Turso parity", async () => {
    assert(health?.database.ok === true, "Server database health is not confirmed; use --allow-database-down only for explicit snapshot fallback");
    assert(savedDatabaseUrl && savedDatabaseToken, "Local TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required to verify database parity");
    const { readSnapshots } = await import("../lib/db/catalog");
    const stored = await readSnapshots();
    assert.deepEqual(stored.map(({ costume }) => costume.slug).sort(), expectedSlugs, "Database must contain every editorial costume exactly once");
    assert.equal((await catalog.readCatalogs()).source, "database", "Configured catalog runtime must use the database");
    const beforeDatabaseErrors = errors.length;
    for (const snapshot of snapshots.values()) await check(`${snapshot.costume.slug} database parity`, async () => {
      const slug = snapshot.costume.slug;
      assert.deepEqual(await catalog.getCostume(slug), await query.getCostume([snapshot], slug), "Database runtime differs from the reviewed bundled catalog");
      for (const piece of snapshot.pieces) {
        for (const filters of [{ costumeSlug: slug }, { costumeSlug: slug, localOnly: true }, { costumeSlug: slug, maxPriceCents: 10_000 }]) {
          assert.deepEqual(optionIdentity(await query.getAlternatives(stored, piece.id, filters)), optionIdentity(await query.getAlternatives([...snapshots.values()], piece.id, filters)), `${piece.id}: database filter results differ`);
        }
      }
      for (const merchant of snapshot.merchants) {
        assert.deepEqual(optionIdentity(await query.getMerchantCatalog(stored, merchant.id, slug)), optionIdentity(await query.getMerchantCatalog([...snapshots.values()], merchant.id, slug)), `${merchant.id}: database merchant results differ`);
      }
    });
    if (errors.length === beforeDatabaseErrors) pass(`${stored.length} database catalogs and scoped query results match the reviewed bundles`);
  });
}

async function main() {
  await check("editorial coverage", () => {
    assert(expectedSlugs.length > 0, "No editorial costumes exist");
    assert.equal(new Set(expectedSlugs).size, expectedSlugs.length, "Editorial slugs repeat");
    assert(costumes.every(({ status }) => status === "live"), "Every editorial costume must be purchasable");
  });
  await check("disk coverage", async () => assert.deepEqual((await readdir("data/costumes")).filter((file) => file.endsWith(".json")).map((file) => file.slice(0, -5)).sort(), expectedSlugs, "Disk catalogs must cover every editorial costume"));
  for (const editorial of costumes) await check(`${editorial.slug} saved catalog`, async () => {
    const snapshot = validateSnapshot(JSON.parse(await readFile(`data/costumes/${editorial.slug}.json`, "utf8")));
    assert.equal(snapshot.costume.slug, editorial.slug, "Catalog filename and slug differ");
    assert.equal(snapshot.costume.status, "live", "Saved costume is not live");
    snapshots.set(editorial.slug, snapshot);
    verifyView(snapshot, await query.getCostume([snapshot], editorial.slug));
    addAsset(editorial.image, `${editorial.slug} generated styling reference`);
    addAsset(snapshot.costume.image, `${editorial.slug} catalog reference`);
  });
  await check("homepage", async () => {
    const response = await get("/");
    assert.equal(response.status, 200);
    const html = rendered(await response.text());
    const tiles = elements(html, "a").filter((element) => hasClass(element, "tile-body"));
    assert.deepEqual(tiles.map((tile) => tile.attributes.href).sort(), expectedSlugs.map((slug) => `/costumes/${slug}`), "Homepage links must expose every purchasable costume");
    assert(!tiles.some((tile) => /style guide/i.test(tile.attributes["aria-label"] ?? "")), "Homepage still labels a costume as a style guide");
    pass(`${tiles.length} homepage tiles link to purchasable costume pages`);
  });
  for (const editorial of costumes) await check(`${editorial.slug} page`, () => verifyPage(editorial, snapshots.get(editorial.slug)));

  let verifiedImages = 0;
  const pending = [...assets.entries()];
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (pending.length) {
      const [file, asset] = pending.shift()!;
      await check(`${file} (${[...asset.owners].join(", ")})`, async () => { await verifyImage(file, asset); verifiedImages++; });
    }
  }));
  if (verifiedImages === assets.size && assets.size > 0) pass(`${verifiedImages} reviewed images fully decode and match served bytes`);

  const health = await check("health response", async () => {
    const response = await get("/api/health");
    const value = await response.json() as Health;
    await check("health status", () => assert.equal(response.status, 200, "Complete catalog health must return HTTP 200"));
    return value;
  });
  if (health) await check("health catalog coverage", () => {
    assert.deepEqual(health.catalogs.map(({ costumeSlug }) => costumeSlug).sort(), expectedSlugs, "Health must cover every editorial costume");
    assert.equal(health.coverage.expectedCostumes, expectedSlugs.length);
    assert.equal(health.coverage.shoppableCostumes, expectedSlugs.length);
    assert.deepEqual(health.coverage.missingCostumeSlugs, []);
    assert.equal(health.database.costumes, expectedSlugs.length);
    assert.equal(health.database.products, new Set([...snapshots.values()].flatMap((snapshot) => snapshot.products.map(({ id }) => id))).size);
    if (health.database.ok) {
      assert.equal(health.status, "ok");
      assert.equal(health.catalogSource, "database");
    } else {
      assert(allowDatabaseDown, "Database is unavailable; --allow-database-down is required for bundled-only QA");
      assert.equal(health.status, "degraded");
      assert.equal(health.catalogSource, "snapshot");
    }
    for (const entry of health.catalogs) {
      const snapshot = snapshots.get(entry.costumeSlug);
      assert(snapshot, `${entry.costumeSlug}: missing reviewed local catalog`);
      assert.equal(entry.pieces, snapshot.pieces.length, `${entry.costumeSlug}: wrong health component count`);
      assert.equal(entry.products, new Set(snapshot.pieces.flatMap(({ matches }) => matches.map(({ productId }) => productId))).size, `${entry.costumeSlug}: wrong health option count`);
      assert(entry.complete && entry.pricePointsComplete, `${entry.costumeSlug}: health reports incomplete shopping options`);
      assert.equal(entry.source, health.catalogSource, `${entry.costumeSlug}: source is inconsistent`);
    }
    pass(`${health.catalogs.length} complete health entries match variable component counts and catalog source ${health.catalogSource}`);
  });
  await check("catalog sources", () => verifySources(health));
  if (errors.length) {
    console.error(`\n${errors.length} full-catalog failure(s) against ${base}:`);
    errors.forEach((error, index) => console.error(`${index + 1}. ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log(`\n${passed} checks passed: ${expectedSlugs.length} purchasable costumes, ${[...snapshots.values()].reduce((sum, snapshot) => sum + snapshot.pieces.length, 0)} components, ${verifiedImages} served images. No purchase or catalog mutation occurred.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
