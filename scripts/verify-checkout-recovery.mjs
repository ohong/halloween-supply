/** Local browser recovery checks use controlled API failures. --merchant also checks a real merchant through the real API.
 * No session or payment is created. Run against `bun dev` with `node scripts/verify-checkout-recovery.mjs LOCAL_URL [--merchant]`.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const base = new URL(process.argv.find((arg) => /^https?:/.test(arg)) ?? "http://127.0.0.1:3415");
assert(["localhost", "127.0.0.1"].includes(base.hostname), "Controlled recovery fixtures must run locally.");
const evidence = process.env.CHECKOUT_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(), "checkout-recovery-"));
const snapshot = JSON.parse(await readFile("data/costumes/velvet-vampire.json", "utf8"));
const slug = snapshot.costume.slug;
const itemFor = (piece, product) => {
  const merchant = snapshot.merchants.find(({ id }) => id === product.merchantId);
  return { pieceId: piece.id, pieceName: piece.name, sizeKind: piece.sizeKind, productId: product.id, title: product.title,
    productUrl: product.url, image: product.merchantImage ?? product.image, priceCents: product.priceCents,
    merchantId: merchant.id, merchantName: merchant.name, availableSizes: product.sizes,
    size: piece.sizeKind === "one_size" ? null : product.sizes[0] ?? null };
};
const selected = snapshot.pieces.filter((piece) => piece.sizeKind !== "one_size");
const lines = selected.slice(0, 3).map((piece) => itemFor(piece, snapshot.products.find(({ id }) => id === piece.matches.find(({ rank }) => rank === 0).productId)));
assert(lines.length >= 2 && lines.every(({ size }) => size), "The fixture needs two explicitly sized real catalog lines.");
const affected = lines[0];
const piece = snapshot.pieces.find(({ id }) => id === affected.pieceId);
const alternative = itemFor(piece, snapshot.products.find(({ id }) => id === piece.matches.find(({ rank }) => rank === 1).productId));
const recovery = { pieceId: affected.pieceId, pieceName: affected.pieceName, productId: affected.productId,
  alternativesHref: `/costumes/${slug}?piece=${encodeURIComponent(piece.id)}`,
  alternatives: [{ item: alternative, availability: "in_stock", checkedAt: new Date().toISOString() }] };
const checks = [];
const pass = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const browser = await chromium.launch();

async function openCart(respond, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/events", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/checkout", async (route) => {
    const result = await respond(route.request().postDataJSON());
    await route.fulfill({ status: result.status === "unverified" ? 503 : 200, json: result });
  });
  await page.goto(new URL("/about", base).href);
  await page.evaluate(({ slug, lines }) => localStorage.setItem("halloween-supply-cart-v1", JSON.stringify({ costumeSlug: slug, items: lines })), { slug, lines });
  await page.reload();
  await page.getByRole("button", { name: /^Cart/ }).click();
  const cart = page.getByRole("dialog", { name: "Cart", exact: true });
  await cart.waitFor();
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("halloween-supply-cart-v1")));
  return { context, page, cart, errors, stored };
}

try {
  const healthResponse = await fetch(new URL("/api/health", base));
  const health = await healthResponse.json();
  assert(health.catalogFacts && Array.isArray(health.catalogs));
  const facts = health.catalogFacts;
  assert.equal(facts.products, facts.fresh + facts.stale + facts.missingOrInvalidCheckedAt);
  assert.equal(facts.products, facts.stock.inStock + facts.stock.outOfStock + facts.stock.unknown);
  assert.equal(facts.maxAgeHours, 36);
  assert(health.catalogs.every(({ facts }) => ["fresh", "stale", "unknown"].includes(facts.status)));
  assert.equal(health.refreshHistory.persisted, false);
  assert.equal((await fetch(new URL("/api/cron/refresh", base))).status, 401);
  pass("health separates structural catalog coverage, fact age and unknown stock; unauthorized refresh cannot write");

  for (const status of ["sold_out", "unverified"]) {
    const test = await openCart(() => ({ status, ...recovery, message: `Controlled ${status} merchant recovery` }));
    try {
      await test.cart.getByRole("button", { name: "Checkout", exact: true }).click();
      const line = test.cart.getByRole("listitem", { name: `${affected.pieceName}, needs attention`, exact: true });
      await line.locator(`[data-checkout-recovery="${status}"]`).waitFor();
      assert(await line.evaluate((element) => element === document.activeElement), "The exact blocked line must receive focus.");
      assert.equal(await line.getByRole("link", { name: /Compare alternatives/ }).getAttribute("href"), recovery.alternativesHref);
      if (status === "unverified") assert(await line.getByRole("button", { name: "Retry live check" }).isVisible());
      await test.page.screenshot({ path: path.join(evidence, `phone-${status}.png`) });
      await line.getByRole("button", { name: /^Replace with / }).click();
      await test.page.waitForFunction((id) => JSON.parse(localStorage.getItem("halloween-supply-cart-v1")).items.some((item) => item.productId === id), alternative.productId);
      const after = await test.stored();
      assert.equal(after.costumeSlug, slug);
      assert.equal(after.items.length, lines.length);
      assert.deepEqual(after.items.filter(({ pieceId }) => pieceId !== affected.pieceId), lines.slice(1));
      assert.equal(await test.cart.locator("[data-checkout-recovery]").count(), 0);
      assert.deepEqual(test.errors, []);
      pass(`${status}: exact line focus, real alternative links and replacement preserve unrelated lines at 390px`);
    } finally { await test.context.close(); }
  }

  const requests = [];
  const newPrice = lines[1].priceCents + 51;
  const laterPrice = affected.priceCents + 77;
  const priceTest = await openCart((body) => {
    requests.push(body);
    if (requests.length === 1) return { status: "price_changed", priceChanges: [{ pieceId: lines[1].pieceId, productId: lines[1].productId, pieceName: lines[1].pieceName, oldCents: lines[1].priceCents, newCents: newPrice }], message: "Review the exact new price." };
    if (requests.length === 2) return { status: "invalid_size", ...recovery, availableSizes: ["Live merchant label"], message: "The old size is unavailable." };
    if (requests.length === 3) return { status: "price_changed", priceChanges: [{ pieceId: affected.pieceId, productId: affected.productId, pieceName: affected.pieceName, oldCents: affected.priceCents, newCents: laterPrice }], message: "Another piece now has a new price." };
    return { status: "error", message: "Controlled stop before creating any checkout session." };
  }, 1440);
  try {
    await priceTest.cart.getByRole("button", { name: "Checkout", exact: true }).click();
    await priceTest.cart.getByRole("button", { name: "Accept prices and checkout", exact: true }).click();
    const choose = priceTest.cart.getByRole("button", { name: `Choose size Live merchant label for ${affected.pieceName}`, exact: true });
    await choose.waitFor();
    await priceTest.page.screenshot({ path: path.join(evidence, "desktop-invalid-size.png") });
    await choose.click();
    await priceTest.page.waitForFunction((id) => JSON.parse(localStorage.getItem("halloween-supply-cart-v1")).items.find((item) => item.pieceId === id)?.size === "Live merchant label", affected.pieceId);
    const after = await priceTest.stored();
    assert.deepEqual(after.items.slice(1), lines.slice(1));
    assert.deepEqual(after.items[0].availableSizes, ["Live merchant label"]);
    await priceTest.cart.getByRole("button", { name: "Checkout", exact: true }).click();
    const priceNotice = priceTest.cart.getByRole("alert").filter({ hasText: "Another piece now has a new price." });
    await priceNotice.waitFor();
    assert.equal(requests[2].items[0].size, "Live merchant label");
    assert.equal(requests[2].acceptedPrices.find(({ pieceId }) => pieceId === lines[1].pieceId).priceCents, newPrice);
    const displayedSubtotal = await priceNotice.getByText(/^New subtotal:/).innerText();
    const displayedCents = Math.round(Number(displayedSubtotal.replace(/^New subtotal:\s*\$|,/g, "")) * 100);
    assert.equal(displayedCents, lines.reduce((sum, line) => sum + line.priceCents, 0) + 51 + 77, "The new review must include the earlier accepted increase.");
    await priceTest.page.screenshot({ path: path.join(evidence, "desktop-sequential-price-review.png") });
    await priceTest.cart.getByRole("button", { name: "Accept prices and checkout", exact: true }).click();
    await priceTest.cart.getByText("Controlled stop before creating any checkout session.").waitFor();
    assert.equal(requests[3].acceptedPrices.reduce((sum, line) => sum + line.priceCents, 0), displayedCents, "The reviewed subtotal must exactly match the next request's accepted prices.");
    assert.equal(requests[3].acceptedPrices.find(({ pieceId }) => pieceId === affected.pieceId).priceCents, laterPrice);
    assert.equal(requests[3].acceptedPrices.find(({ pieceId }) => pieceId === lines[1].pieceId).priceCents, newPrice);
    pass("sequential price reviews retain earlier approvals after recovery and show the exact total submitted for acceptance");
    await priceTest.page.reload();
    const persisted = await priceTest.stored();
    assert.equal(persisted.items[0].size, "Live merchant label");
    assert.deepEqual(priceTest.errors, []);
    pass("offered live sizes repair stale catalog labels, survive reload and preserve explicit price approval on unchanged products");
  } finally { await priceTest.context.close(); }

  if (process.argv.includes("--merchant")) {
    const merchantSnapshot = JSON.parse(await readFile("data/costumes/cosmic-cowboy.json", "utf8"));
    const merchantPiece = merchantSnapshot.pieces.find(({ id }) => id === "fringe-jacket");
    const merchantProductId = merchantPiece.matches.find(({ rank }) => rank === 0).productId;
    const response = await fetch(new URL("/api/checkout", base), { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ costumeSlug: slug, items: [{ pieceId: merchantPiece.id, productId: merchantProductId, size: "NOT-A-MERCHANT-SIZE" }] }), signal: AbortSignal.timeout(90_000) });
    const result = await response.json();
    assert.equal(result.status, "invalid_size", `Real merchant response: ${JSON.stringify(result)}`);
    assert.equal(result.productId, merchantProductId);
    assert(result.availableSizes.length > 0);
    assert(result.alternatives.every(({ item }) => item.pieceId === merchantPiece.id && item.productId !== merchantProductId));
    assert.equal(result.alternativesHref, `/costumes/cosmic-cowboy?piece=${encodeURIComponent(merchantPiece.id)}`);
    pass("real merchant rejects an unoffered exact size; a mixed cart resolves alternatives to the real source costume without creating a session");
  }
} finally {
  await writeFile(path.join(evidence, "results.json"), JSON.stringify({ checks, evidence, sessionsCreated: 0, mode: "local controlled recovery fixtures; optional real merchant invalid-size check" }, null, 2));
  await browser.close();
  console.log(`Evidence: ${evidence}`);
}
