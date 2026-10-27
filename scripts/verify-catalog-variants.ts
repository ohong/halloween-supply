/** Real merchant checks; optional, scoped repair of catalog facts. No payment or model calls.
 * bun --env-file=.env.local scripts/verify-catalog-variants.ts --output=/tmp/variant-evidence.json
 * Add --write-snapshots to update bundled facts, or --apply to patch verified database fields.
 */
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import type { CostumeSnapshot, Product } from "../lib/types";
import { validateSnapshot } from "../lib/catalog/validate";
import { readSnapshots, updateProducts, type ProductUpdate } from "../lib/db/catalog";
import { mapLimit } from "../lib/sourcing/pool";

type BunRuntime = { plugin(plugin: { name: string; setup(build: { module(name: string, loader: () => unknown): void }): void }): void };
(globalThis as unknown as { Bun: BunRuntime }).Bun.plugin({ name: "catalog-variant-checks", setup(build) { build.module("server-only", () => ({ exports: {}, loader: "object" })); } });
// Exercise direct official merchant sources only. A blocked page must fail without a paid fallback.
delete process.env.FIRECRAWL_API_KEY;
const { verifyProduct } = await import("../lib/checkout/verify");
const slugs = new Set(["jellyfish-bloom", "venus-flytrap", "walking-thundercloud", "silent-film-star"]);
const merchants = new Set(["fabricwholesaledirect.com", "www.benziedesign.com", "camerareadycosmetics.com", "goodsstores.com"]);
const files = (await readdir("data/costumes")).filter((name) => name.endsWith(".json")).sort();
const snapshots: CostumeSnapshot[] = await Promise.all(files.map(async (file) => validateSnapshot(JSON.parse(await readFile(`data/costumes/${file}`, "utf8")))));
const products = [...new Map(snapshots.filter(({ costume }) => slugs.has(costume.slug)).flatMap(({ products }) => products).filter((product) => merchants.has(new URL(product.url).hostname)).map((product) => [product.id, product])).values()];
assert.equal(products.length, 13, "Expected the 13 reviewed offers associated with the four variant-price gaps");

type Variant = { id: number; title: string; price: number; available: boolean };
type MerchantProduct = { handle: string; variants: Variant[] };
const getJson = async (url: URL) => {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000), headers: { Accept: "application/json" } });
  assert(response.ok, `Merchant API returned HTTP ${response.status}: ${url.origin}${url.pathname}`);
  assert.equal(new URL(response.url).hostname, url.hostname, "Merchant API redirected to another host");
  return response.json();
};
const evidence: { productId: string; url: string; endpoint: string; currency: string; variant: Variant; checkedAt: string }[] = [];
const updates: ProductUpdate[] = [];
const results = await mapLimit(products, 3, async (product: Product) => {
  const url = new URL(product.url);
  const endpoint = new URL(url); endpoint.pathname += ".js"; endpoint.search = "";
  const [merchant, cart] = await Promise.all([getJson(endpoint) as Promise<MerchantProduct>, getJson(new URL("/cart.js", url)) as Promise<{ currency: string }>]);
  assert.equal(cart.currency, "USD", `${product.id}: merchant must confirm USD`);
  assert.equal(merchant.handle, url.pathname.split("/").at(-1), "Merchant returned a different product");
  const variant = merchant.variants.find(({ id }) => String(id) === url.searchParams.get("variant"));
  assert(variant && Number.isSafeInteger(variant.price) && variant.price > 0 && typeof variant.available === "boolean", "Pinned merchant offer is missing");
  const verified = await verifyProduct(product);
  assert(verified.verified, `${product.id}: ${!verified.verified && verified.reason}`);
  assert.equal(verified.variantId, String(variant.id), `${product.id}: refresh switched the selected variant`);
  assert.equal(verified.productUrl, product.url, `${product.id}: refresh changed the merchant purchase link`);
  assert.equal(verified.priceCents, variant.price, `${product.id}: refresh used a different variant's price`);
  assert.equal(verified.availability, variant.available ? "in_stock" : "out_of_stock");
  const checkout = await verifyProduct(product, null);
  assert(checkout.verified && checkout.variantId === verified.variantId && checkout.priceCents === verified.priceCents, `${product.id}: checkout and refresh disagree`);
  evidence.push({ productId: product.id, url: product.url, endpoint: endpoint.href, currency: cart.currency, variant, checkedAt: verified.checkedAt });
  updates.push({ id: product.id, priceCents: verified.priceCents, availability: verified.availability, sizes: verified.sizes, checkedAt: verified.checkedAt });
  console.log(`PASS ${product.id}: ${variant.title}, USD ${(variant.price / 100).toFixed(2)}, same variant for refresh and checkout`);
});
for (const result of results) if (!result.ok) throw result.error;

const makeup = products.find(({ id }) => id === "exp-b-68a3dcfb87da")!;
const smallerMakeup = evidence.find(({ productId }) => productId === "exp-b-9dd26e08251d")!;
const requestedSize = await verifyProduct(makeup, "3.0oz (CW-3)");
assert(requestedSize.verified && requestedSize.variantId === String(smallerMakeup.variant.id) && requestedSize.priceCents === smallerMakeup.variant.price, "An explicit shopper size must still select that exact size");
const soldOutUrl = new URL(makeup.url); soldOutUrl.searchParams.set("variant", "22326378695");
const soldOut = await verifyProduct({ ...makeup, url: soldOutUrl.href });
assert(soldOut.verified && soldOut.variantId === "22326378695" && soldOut.availability === "out_of_stock", "A sold-out pinned variant must not switch to an available pack");
const missingUrl = new URL(makeup.url); missingUrl.searchParams.set("variant", "999999999999999");
const missing = await verifyProduct({ ...makeup, url: missingUrl.href });
assert(!missing.verified, "A removed pinned variant must fail verification");
const invalidSize = await verifyProduct(makeup, "not-a-merchant-size");
assert(!invalidSize.verified && invalidSize.invalidSize, "An unknown shopper size must fail verification");
console.log("PASS explicit size changes, sold-out pins, removed variants, and invalid sizes");

const byId = new Map(updates.map((update) => [update.id, update]));
function patched(snapshot: CostumeSnapshot) {
  return { ...snapshot, products: snapshot.products.map((product) => ({ ...product, ...byId.get(product.id) })) };
}
function assertComplete(values: CostumeSnapshot[]) {
  assert.equal(values.length, 50);
  for (const snapshot of values) {
    validateSnapshot(snapshot, false);
    const prices = new Map(snapshot.products.map((product) => [product.id, product.priceCents]));
    for (const piece of snapshot.pieces) assert.equal(new Set(piece.matches.map(({ productId }) => prices.get(productId))).size, 3, `${snapshot.costume.slug}/${piece.id}: price points remain incomplete`);
  }
}
const repaired = snapshots.map(patched);
assertComplete(repaired);
if (process.argv.includes("--write-snapshots")) {
  let written = 0;
  for (const snapshot of repaired) if (snapshot.products.some(({ id }) => byId.has(id))) {
    await writeFile(`data/costumes/${snapshot.costume.slug}.json`, JSON.stringify(validateSnapshot(snapshot), null, 2) + "\n"); written++;
  }
  console.log(`Updated verified facts in ${written} bundled catalogs`);
}
let databaseWritten = 0;
if (process.argv.includes("--apply")) {
  const before = await readSnapshots();
  assertComplete(before.map(patched));
  await writeFile(`/tmp/halloween-catalog-before-variant-repair-${Date.now()}.json`, JSON.stringify(before, null, 2) + "\n");
  databaseWritten = await updateProducts(updates);
  assert.equal(databaseWritten, updates.length, "Every verified offer must be patched");
  assertComplete(await readSnapshots());
  console.log(`Patched ${databaseWritten} verified database products; all 50 catalogs have distinct price points`);
}
const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length);
if (output) await writeFile(output, JSON.stringify({ checkedAt: new Date().toISOString(), method: "Direct merchant Ajax product and currency endpoints, compared with the real refresh/checkout verifier", offers: evidence.sort((a, b) => a.productId.localeCompare(b.productId)), updates, databaseWritten, cases: ["13 exact merchant variants", "13 pinned checkout selections", "explicit size selection", "sold-out pin", "removed pin", "invalid size"], allCatalogPricePointsComplete: true }, null, 2) + "\n");
console.log("PASS 30 live merchant verification cases and all 50 projected catalog price-point checks");
