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

function verifyView(snapshot: CostumeSnapshot, view: CostumeView | null, publication = true) {
  assert(view, "Catalog query returned no purchasable costume");
  assert.equal(view.pieces.length, snapshot.pieces.length, "A component disappeared from the catalog query");
  for (const { piece, options } of view.pieces) {
    assert.equal(options.length, 3, `${piece.id}: expected three shopping options`);
    assert.deepEqual(options.map(({ pick }) => pick.rank), [0, 1, 2], `${piece.id}: ranks must identify the default and two alternatives`);
    assert.equal(new Set(options.map(({ product }) => product.id)).size, 3, `${piece.id}: product options repeat`);
    assert.equal(new Set(options.map(({ product }) => product.priceCents)).size, 3, `${piece.id}: prices repeat`);
    assert.deepEqual(options.map(({ pick }) => pick.priceTier).sort(), ["$", "$$", "$$$"], `${piece.id}: price tiers are incomplete`);
    if (publication) {
      assert.equal(options[0].product.availability, "in_stock", `${piece.id}: publication default must be in stock`);
      assert(options.every(({ product }) => product.availability !== "out_of_stock"), `${piece.id}: publication alternative is sold out`);
    }
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
  assert(elements(html, "button").some((button) => text(button.inner) === "Add costume to cart"), "Missing whole-costume shopping control");
  const modelImage = `/costumes/models/${editorial.slug}-female.webp`;
  assert(html.includes(modelImage) || html.includes(encodeURIComponent(modelImage)), "Default model complete-look reference is missing");
  if (!snapshot) return;
  const view = await query.getCostume([snapshot], editorial.slug);
  assert(view, "No local view is available for page comparison");
  const rows = elements(html, "li").filter((element) => hasClass(element, "outfit-piece"));
  const labels = (html: string) => [...html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<span\b([^>]*)>([^<]*)<\/span>/gi)]
    .map((match) => ({ attributes: attributes(match[1]), inner: match[2] }));
  assert.equal(rows.length, view.pieces.length, "Rendered component count differs from the saved catalog");
  for (const { piece, options } of view.pieces) {
    const row = rows.find((candidate) => labels(candidate.inner).some((label) => hasClass(label, "outfit-piece-name") && text(label.inner) === piece.name));
    assert(row, `${piece.id}: no shopping row`);
    const chosen = options[0];
    const link = elements(row.inner, "a").find((candidate) => hasClass(candidate, "outfit-piece-trigger") && candidate.attributes.href === chosen.product.url);
    assert(link, `${piece.id}: missing exact default merchant purchase URL`);
    assert.equal(link.attributes["aria-label"], `View ${piece.name} at ${chosen.merchant.name} (opens in a new window)`, `${piece.id}: default merchant/product is incorrect`);
    assert.equal(link.attributes.target, "_blank", `${piece.id}: merchant link must open a separate tab`);
    assert([...link.inner.matchAll(/<img\b([^>]*)>/gi)].some((match) => attributes(match[1]).src === chosen.product.merchantImage), `${piece.id}: default merchant photo is not displayed`);
    assert(labels(row.inner).some((element) => hasClass(element, "outfit-piece-product") && text(element.inner) === chosen.product.title), `${piece.id}: default product title is missing`);
    const merchantLabel = [chosen.merchant.name, chosen.pick.isLocal ? "Local" : "", chosen.product.availability === "out_of_stock" ? "Sold out" : ""].filter(Boolean).join(" · ");
    assert(labels(row.inner).some((element) => hasClass(element, "outfit-piece-merchant") && text(element.inner) === merchantLabel), `${piece.id}: default merchant name or stock label is incorrect`);
    assert(elements(row.inner, "a").some((element) => element.attributes.href === chosen.product.url && text(element.inner) === price(chosen.product.priceCents)), `${piece.id}: default merchant price is missing`);
    // Alternatives, per-piece cart actions and pick explanations render after opening this dialog.
    assert(elements(row.inner, "button").some((button) => button.attributes["aria-label"] === `Change ${piece.name}` && button.attributes["aria-haspopup"] === "dialog"), `${piece.id}: no alternative dialog control`);
  }
  pass(`${editorial.slug}: ${view.pieces.length} shopping rows, default prices, real merchant links and photographs, alternative dialog controls`);
}

const optionIdentity = (options: ProductOption[]) => options.map(({ product, merchant, pick }) => ({ product, merchant, pick }));

/** Routine merchant refreshes may change these four facts without republishing a look. */
function withStoredFacts(reviewed: CostumeSnapshot, stored: CostumeSnapshot): CostumeSnapshot {
  const byId = new Map(stored.products.map((product) => [product.id, product]));
  return { ...reviewed, products: reviewed.products.map((product) => {
    const facts = byId.get(product.id);
    assert(facts, `${reviewed.costume.slug}/${product.id}: reviewed product is absent from the database`);
    const { priceCents, availability, sizes, checkedAt } = facts;
    return { ...product, priceCents, availability, sizes, checkedAt };
  }) };
}

async function verifySources(health?: Health, stored?: CostumeSnapshot[]) {
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
    assert(stored, "Stored database snapshots are required for parity verification");
    assert.deepEqual(stored.map(({ costume }) => costume.slug).sort(), expectedSlugs, "Database must contain every editorial costume exactly once");
    assert.equal((await catalog.readCatalogs()).source, "database", "Configured catalog runtime must use the database");
    const storedBySlug = new Map(stored.map((snapshot) => [snapshot.costume.slug, snapshot]));
    const refreshed = [...snapshots.values()].map((snapshot) => withStoredFacts(snapshot, storedBySlug.get(snapshot.costume.slug)!));
    const beforeDatabaseErrors = errors.length;
    for (const snapshot of snapshots.values()) await check(`${snapshot.costume.slug} database parity`, async () => {
      const slug = snapshot.costume.slug;
      const actual = storedBySlug.get(slug)!;
      assert.deepEqual(actual, withStoredFacts(snapshot, actual), "Immutable database catalog facts differ from the reviewed bundle");
      const view = await catalog.getCostume(slug);
      assert.deepEqual(view, await query.getCostume([actual], slug), "Database runtime differs from the stored catalog");
      verifyView(actual, view, false);
      for (const piece of snapshot.pieces) {
        for (const filters of [{ costumeSlug: slug }, { costumeSlug: slug, localOnly: true }, { costumeSlug: slug, maxPriceCents: 10_000 }]) {
          assert.deepEqual(optionIdentity(await query.getAlternatives(stored, piece.id, filters)), optionIdentity(await query.getAlternatives(refreshed, piece.id, filters)), `${piece.id}: database filter results differ`);
        }
      }
      for (const merchant of snapshot.merchants) {
        assert.deepEqual(optionIdentity(await query.getMerchantCatalog(stored, merchant.id, slug)), optionIdentity(await query.getMerchantCatalog(refreshed, merchant.id, slug)), `${merchant.id}: database merchant results differ`);
      }
    });
    if (errors.length === beforeDatabaseErrors) {
      const products = stored.flatMap((snapshot) => snapshot.products);
      pass(`${stored.length} database catalogs preserve reviewed immutable facts and match refreshed runtime/query results`);
      console.log(`INFO stored stock evidence: ${products.filter((product) => product.availability === "in_stock").length} in stock, ${products.filter((product) => product.availability === "out_of_stock").length} sold out, ${products.filter((product) => product.availability === "unknown").length} unknown product records; merchant checkout still rechecks these facts`);
    }
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
  const health = await check("health response", async () => {
    const response = await get("/api/health");
    const value = await response.json() as Health;
    await check("health status", () => assert.equal(response.status, 200, "Complete catalog health must return HTTP 200"));
    return value;
  });
  const stored = health?.catalogSource === "database" ? await check("database snapshots", async () => {
    assert(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN, "Local database credentials are required to verify database-backed pages");
    const { readSnapshots } = await import("../lib/db/catalog");
    return readSnapshots();
  }) : undefined;
  const pageSnapshots = health?.catalogSource === "database"
    ? new Map(stored?.map((snapshot) => [snapshot.costume.slug, snapshot])) : snapshots;
  await check("homepage", async () => {
    const response = await get("/");
    assert.equal(response.status, 200);
    const html = rendered(await response.text());
    const tiles = elements(html, "a").filter((element) => hasClass(element, "tile-body"));
    assert.deepEqual(tiles.map((tile) => tile.attributes.href).sort(), expectedSlugs.map((slug) => `/costumes/${slug}`), "Homepage links must expose every purchasable costume");
    assert(!tiles.some((tile) => /style guide/i.test(tile.attributes["aria-label"] ?? "")), "Homepage still labels a costume as a style guide");
    pass(`${tiles.length} homepage tiles link to purchasable costume pages`);
  });
  for (const editorial of costumes) await check(`${editorial.slug} page`, () => {
    const snapshot = pageSnapshots.get(editorial.slug);
    assert(snapshot, "The reported catalog source must contain this costume for page verification");
    return verifyPage(editorial, snapshot);
  });

  let verifiedImages = 0;
  const pending = [...assets.entries()];
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (pending.length) {
      const [file, asset] = pending.shift()!;
      await check(`${file} (${[...asset.owners].join(", ")})`, async () => { await verifyImage(file, asset); verifiedImages++; });
    }
  }));
  if (verifiedImages === assets.size && assets.size > 0) pass(`${verifiedImages} reviewed images fully decode and match served bytes`);

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
  await check("catalog sources", () => verifySources(health, stored));
  if (errors.length) {
    console.error(`\n${errors.length} full-catalog failure(s) against ${base}:`);
    errors.forEach((error, index) => console.error(`${index + 1}. ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log(`\n${passed} checks passed: ${expectedSlugs.length} purchasable costumes, ${[...snapshots.values()].reduce((sum, snapshot) => sum + snapshot.pieces.length, 0)} components, ${verifiedImages} served images. No purchase or catalog mutation occurred.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
