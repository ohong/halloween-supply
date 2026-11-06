/** Campaign checks against a running app. No provider generation or payment sessions. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const base = new URL(process.argv.find((arg) => /^https?:/.test(arg)) ?? "http://127.0.0.1:3100");
const evidence = process.env.SHOPPING_EVIDENCE_DIR ?? `/tmp/halloween-shopping-campaign-${Date.now()}`;
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const results = [];
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch();
const capturedEvents = [];
const errors = [];
let contextSequence = 0;
async function makeContext(options = {}) {
  const created = await browser.newContext(options);
  const contextId = ++contextSequence;
  created.on("page", (createdPage) => createdPage.on("pageerror", (error) => errors.push(`Context ${contextId}: ${error.message}`)));
  created.on("request", (request) => {
    if (new URL(request.url()).pathname !== "/api/events" || request.method() !== "POST") return;
    try { capturedEvents.push({ contextId, payload: request.postDataJSON() }); } catch { /* The payload assertion reports malformed event data. */ }
  });
  return created;
}
const context = await makeContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(15_000);

async function check(name, run) {
  if (only && !name.includes(only)) return;
  const started = performance.now();
  try {
    const detail = await run();
    results.push({ name, status: "passed", durationMs: Math.round(performance.now() - started), detail });
    console.log(`PASS ${name}`);
  } catch (error) {
    const screenshot = path.join(evidence, `${name.replace(/[^a-z0-9]+/gi, "-")}-failure.png`);
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    results.push({ name, status: "failed", error: error instanceof Error ? error.message : String(error), screenshot });
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function navigate(target, targetPage = page) {
  const response = await targetPage.goto(new URL(target, base).href, { waitUntil: "domcontentloaded" });
  assert.equal(response?.status(), 200, `${target} must load`);
}
async function storedCart(targetPage = page) {
  return targetPage.evaluate(() => JSON.parse(localStorage.getItem("halloween-supply-cart-v1") ?? "null"));
}
async function waitCart(expectedIds, targetPage = page) {
  await targetPage.waitForFunction((ids) => {
    const cart = JSON.parse(localStorage.getItem("halloween-supply-cart-v1") ?? "null");
    return cart?.items && JSON.stringify(cart.items.map((item) => item.productId).sort()) === JSON.stringify([...ids].sort());
  }, expectedIds);
  return storedCart(targetPage);
}
async function copyLookLink(targetPage = page) {
  await targetPage.evaluate(() => {
    window.__copiedLook = null;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.__copiedLook = text; } } });
  });
  await targetPage.getByRole("button", { name: /Copy look link|Copy link again/ }).click();
  await targetPage.waitForFunction(() => typeof window.__copiedLook === "string");
  return targetPage.evaluate(() => window.__copiedLook);
}
function toItem(row, option) {
  return { pieceId: row.piece.id, pieceName: row.piece.name, sizeKind: row.piece.sizeKind, productId: option.product.id,
    title: option.product.title, productUrl: option.product.url, image: option.product.merchantImage ?? option.product.cutout ?? option.product.image,
    merchantId: option.merchant.id, merchantName: option.merchant.name, priceCents: option.product.priceCents,
    availableSizes: option.product.sizes, size: row.piece.sizeKind === "one_size" ? null : option.product.sizes[0] ?? null };
}

try {
  await check("discovery price, search, Saved, and model", async () => {
    await navigate("/");
    const tiles = page.locator("#costume-results > li");
    await page.getByRole("combobox", { name: "Price" }).selectOption("10000");
    await page.waitForFunction(() => document.querySelectorAll("#costume-results > li").length > 0);
    const affordableNames = await tiles.locator(".tile-name").allTextContents();
    assert(affordableNames.length >= 1 && affordableNames.length < 50, "Price filtering changes the gallery");
    const first = tiles.first();
    const save = first.getByRole("button", { name: /^Save / });
    const name = (await save.getAttribute("aria-label")).replace(/^Save /, "");
    await save.click();
    await page.getByRole("combobox", { name: "Model", exact: true }).selectOption("male");
    await page.getByRole("button", { name: /^Saved/ }).click();
    assert.equal(await tiles.count(), 1);
    await page.getByRole("searchbox", { name: "Search costumes", exact: true }).fill(name);
    await page.waitForFunction(() => !document.querySelector("#costume-search-status")?.textContent?.includes("Finding related looks"));
    assert.equal(await tiles.count(), 1, "Saved and price filters retain an exact search result");
    assert.match(await tiles.first().locator("img").getAttribute("src"), /-male\.webp/);
    await page.screenshot({ path: path.join(evidence, "discovery-desktop.png"), fullPage: true });
    return { affordableCount: affordableNames.length, selectedName: name };
  });

  await check("ten completion kits charge only their listed new pieces", async () => {
    const { KITS } = await import("../data/kits/index.ts");
    assert.equal(KITS.length, 10, "The campaign publishes ten priority kits");
    const checked = [];
    for (const kit of KITS) {
      const fresh = await makeContext();
      try {
        const targetPage = await fresh.newPage();
        targetPage.setDefaultTimeout(15_000);
        const catalog = await (await fresh.request.get(new URL(`/api/live-mirror/catalog?slug=${kit.costumeSlug}`, base).href)).json();
        await navigate(`/costumes/${kit.costumeSlug}?kit=${kit.slug}`, targetPage);
        await targetPage.getByRole("button", { name: "Reapply this kit", exact: true }).waitFor();
        await targetPage.locator('.costume-kit input[type="date"]:visible').fill("2026-12-31");
        for (const owned of kit.owned) {
          const row = catalog.pieces.find((row) => row.piece.id === owned.pieceId);
          assert.equal(await targetPage.getByRole("combobox", { name: `Use ${row.piece.name}`, exact: true }).inputValue(), "owned");
        }
        for (const skipped of kit.skipped) {
          const row = catalog.pieces.find((row) => row.piece.id === skipped.pieceId);
          assert.equal(await targetPage.getByRole("combobox", { name: `Use ${row.piece.name}`, exact: true }).inputValue(), "skip");
        }
        const shared = JSON.parse(new URL(await copyLookLink(targetPage)).searchParams.get("selection"));
        const expectedPairs = kit.buy.map(({ pieceId, productId }) => ({ pieceId, productId })).sort((a, b) => a.pieceId.localeCompare(b.pieceId));
        assert.deepEqual(shared.selection.sort((a, b) => a.pieceId.localeCompare(b.pieceId)), expectedPairs);
        await targetPage.getByRole("button", { name: "Add costume to cart", exact: true }).click();
        const cart = await waitCart(kit.buy.map(({ productId }) => productId), targetPage);
        const subtotalCents = kit.buy.reduce((sum, entry) => {
          const option = catalog.pieces.find((row) => row.piece.id === entry.pieceId).options.find((option) => option.product.id === entry.productId);
          return sum + option.product.priceCents;
        }, 0);
        assert.equal(cart.items.reduce((sum, item) => sum + item.priceCents, 0), subtotalCents);
        assert(subtotalCents <= 10_000, `${kit.slug} exceeds the campaign's $100 target`);
        const labels = await targetPage.locator(".costume-kit:visible").innerText();
        assert.match(labels, /Already own:/);
        assert.match(labels, /Assembly:/);
        assert.match(labels, /Delivery is unconfirmed|Known too late|Pickup option found/);
        if (checked.length === 0) await targetPage.screenshot({ path: path.join(evidence, "kit-exact-cart.png") });
        checked.push({ slug: kit.slug, piecesCharged: cart.items.length, ownedCount: kit.owned.length, subtotalCents });
      } finally { await fresh.close(); }
    }
    return checked;
  });

  await check("complete selection survives save, reload, and a fresh-browser share", async () => {
    const snapshot = JSON.parse(await readFile(new URL("../data/costumes/cosmic-cowboy.json", import.meta.url), "utf8"));
    const donor = JSON.parse(await readFile(new URL("../data/costumes/velvet-vampire.json", import.meta.url), "utf8"));
    const swapped = snapshot.pieces.find((piece) => piece.id === "silver-trousers");
    const cape = donor.pieces.find((piece) => piece.id === "vampire-cape");
    const mix = { costumeSlug: donor.costume.slug, pieceId: cape.id, productId: cape.matches[0].productId, replacesPieceId: "fringe-jacket" };
    const selection = {
      version: 1, costumeSlug: snapshot.costume.slug,
      selection: [
        { pieceId: swapped.id, productId: swapped.matches[1].productId },
        { pieceId: "western-boots", productId: snapshot.pieces.find((piece) => piece.id === "western-boots").matches[0].productId },
        { pieceId: cape.id, productId: mix.productId },
      ],
      ownedPieceIds: ["cowboy-hat"], skippedPieceIds: ["neckerchief"], mixes: [mix], model: "male",
      previewEdits: { "silver-trousers": { color: "violet" } },
    };
    const target = `/costumes/${snapshot.costume.slug}?selection=${encodeURIComponent(JSON.stringify(selection))}`;
    await navigate(target);
    await page.getByRole("heading", { name: snapshot.costume.name, exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="Use Silver cowboy hat"]')?.value === "owned");
    assert.equal(await page.getByRole("combobox", { name: "Use Silver cowboy hat", exact: true }).inputValue(), "owned");
    assert.equal(await page.getByRole("combobox", { name: "Use Bright blue neckerchief", exact: true }).inputValue(), "skip");
    assert.equal(await page.getByRole("button", { name: "Change Fringed western jacket", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Change Black velvet cape", exact: true }).waitFor();
    const save = page.getByRole("button", { name: `Save ${snapshot.costume.name}`, exact: true });
    if (await save.count()) await save.click();
    const copied = await copyLookLink();
    const shared = JSON.parse(new URL(copied).searchParams.get("selection"));
    assert.deepEqual([...shared.selection].sort((a, b) => a.pieceId.localeCompare(b.pieceId)), [...selection.selection].sort((a, b) => a.pieceId.localeCompare(b.pieceId)));
    assert.deepEqual(shared.ownedPieceIds, selection.ownedPieceIds);
    assert.deepEqual(shared.skippedPieceIds, selection.skippedPieceIds);
    assert.deepEqual(shared.mixes, selection.mixes);
    assert.equal(shared.model, "male");
    assert.deepEqual(shared.previewEdits, selection.previewEdits);
    assert(!/size/i.test(JSON.stringify(shared)), "Public sharing excludes private sizes");
    await page.getByText("Visual edits are saved as preview notes. Merchant products remain the choices listed below.", { exact: true }).waitFor();
    await navigate(`/costumes/${snapshot.costume.slug}`);
    await page.waitForFunction(() => document.querySelector('[aria-label="Use Silver cowboy hat"]')?.value === "owned");
    const fresh = await makeContext();
    try {
      const freshPage = await fresh.newPage();
      freshPage.setDefaultTimeout(15_000);
      await navigate(copied, freshPage);
      await freshPage.getByRole("button", { name: "Add costume to cart", exact: true }).click();
      const cart = await waitCart(selection.selection.map(({ productId }) => productId), freshPage);
      const allProducts = [...snapshot.products, ...donor.products];
      const expectedSubtotal = selection.selection.reduce((sum, row) => sum + allProducts.find((product) => product.id === row.productId).priceCents, 0);
      assert.equal(cart.items.reduce((sum, item) => sum + item.priceCents, 0), expectedSubtotal);
      await freshPage.screenshot({ path: path.join(evidence, "shared-selection-cart.png") });
      return { productIds: cart.items.map(({ productId }) => productId), subtotalCents: expectedSubtotal };
    } finally { await fresh.close(); }
  });

  await check("invalid and retired selection shows repair state", async () => {
    await navigate(`/costumes/cosmic-cowboy?selection=${encodeURIComponent(JSON.stringify({ version: 99 }))}`);
    await page.getByText(/saved look is invalid|unsupported version/i).waitFor();
    assert(await page.getByRole("button", { name: "Add costume to cart", exact: true }).isDisabled(), "An invalid snapshot blocks whole-costume purchase");
    assert(await page.getByRole("button", { name: "Copy look link", exact: true }).isDisabled(), "An invalid snapshot cannot be reshared");
    const retired = { version: 1, costumeSlug: "cosmic-cowboy", selection: [{ pieceId: "cowboy-hat", productId: "retired-product" }], ownedPieceIds: [], skippedPieceIds: [], mixes: [], model: "female" };
    await navigate(`/costumes/cosmic-cowboy?selection=${encodeURIComponent(JSON.stringify(retired))}`);
    await page.getByText(/needs an available product|no longer available/i).first().waitFor();
    assert(await page.getByRole("button", { name: "Add costume to cart", exact: true }).isDisabled(), "A retired selection blocks purchase until repaired");
    const incomplete = { version: 1, costumeSlug: "cosmic-cowboy", selection: [], ownedPieceIds: ["cowboy-hat"], skippedPieceIds: [], mixes: [], model: "female" };
    await navigate(`/costumes/cosmic-cowboy?selection=${encodeURIComponent(JSON.stringify(incomplete))}`);
    await page.getByRole("alert").filter({ hasText: /look needs a repair/i }).waitFor();
    const addAll = page.getByRole("button", { name: "Add costume to cart", exact: true });
    assert(await addAll.isDisabled(), "An incomplete snapshot blocks whole-costume purchase");
    assert(await page.getByRole("combobox", { name: "Use Fringed western jacket", exact: true }).isDisabled());
    await page.getByRole("button", { name: "Change Fringed western jacket", exact: true }).click();
    const dialog = page.getByRole("dialog");
    assert(await dialog.getByRole("button", { name: "Add this piece", exact: true }).isDisabled());
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Pieces", exact: true }).click();
    await page.getByRole("button", { name: "Inspect Fringed western jacket", exact: true }).click();
    assert(await page.locator(".costume-piece-inspector:visible").getByRole("button", { name: "Add piece to cart", exact: true }).isDisabled());
    await page.getByRole("button", { name: "Close Fringed western jacket details", exact: true }).click();
    await page.getByRole("button", { name: "Use available picks", exact: true }).click();
    assert(await addAll.isEnabled(), "An explicit repair enables the resolved choices");
  });

  await check("shared look removes owned and skipped lines from an existing cart", async () => {
    const fresh = await makeContext();
    try {
      const targetPage = await fresh.newPage();
      targetPage.setDefaultTimeout(15_000);
      const catalog = await (await fresh.request.get(new URL("/api/live-mirror/catalog?slug=cosmic-cowboy", base).href)).json();
      const items = catalog.pieces.map((row) => toItem(row, row.options[0]));
      await navigate("/", targetPage);
      await targetPage.evaluate((stored) => localStorage.setItem("halloween-supply-cart-v1", JSON.stringify(stored)), { costumeSlug: "cosmic-cowboy", items });
      const selection = { version: 1, costumeSlug: "cosmic-cowboy", selection: items.filter((item) => !["cowboy-hat", "neckerchief"].includes(item.pieceId)).map(({ pieceId, productId }) => ({ pieceId, productId })),
        ownedPieceIds: ["cowboy-hat"], skippedPieceIds: ["neckerchief"], mixes: [], model: "female" };
      await navigate(`/costumes/cosmic-cowboy?selection=${encodeURIComponent(JSON.stringify(selection))}`, targetPage);
      await targetPage.waitForFunction(() => document.querySelector('[aria-label="Use Silver cowboy hat"]')?.value === "owned");
      await targetPage.getByRole("button", { name: "Add costume to cart", exact: true }).click();
      const cart = await waitCart(selection.selection.map(({ productId }) => productId), targetPage);
      assert.equal(cart.items.length, items.length - 2);
      return { existingLines: items.length, chargedLines: cart.items.length, ownedAndSkippedCharged: 0 };
    } finally { await fresh.close(); }
  });

  await check("cart recovery keeps other lines and requires price acceptance (response fixtures)", async () => {
    const fresh = await makeContext();
    const targetPage = await fresh.newPage();
    try {
      targetPage.setDefaultTimeout(15_000);
      const catalog = await (await fresh.request.get(new URL("/api/live-mirror/catalog?slug=cosmic-cowboy", base).href)).json();
      const items = catalog.pieces.map((row) => toItem(row, row.options[0]));
      const target = items.find((item) => item.sizeKind === "apparel");
      assert(target, "The fixture needs a sized apparel line");
      const row = catalog.pieces.find((row) => row.piece.id === target.pieceId);
      const alternative = toItem(row, row.options.find((option) => option.product.id !== target.productId && option.product.availability !== "out_of_stock"));
      assert(alternative.size || alternative.sizeKind === "one_size", "The replacement fixture needs a valid offered size");
      await navigate("/", targetPage);
      await targetPage.evaluate((stored) => localStorage.setItem("halloween-supply-cart-v1", JSON.stringify(stored)), { costumeSlug: "cosmic-cowboy", items });
      await navigate("/costumes/cosmic-cowboy", targetPage);
      await targetPage.locator(".site-header .cart-count").waitFor();
      await targetPage.locator(".site-header").getByRole("button", { name: /^Cart/ }).click();
      const cart = targetPage.getByRole("dialog", { name: "Cart", exact: true });
      await cart.waitFor();
      const original = await storedCart(targetPage);
      const unrelated = original.items.filter((item) => item.pieceId !== target.pieceId);
      const recovery = { pieceId: target.pieceId, pieceName: target.pieceName, productId: target.productId,
        alternativesHref: `/costumes/cosmic-cowboy?piece=${target.pieceId}`,
        alternatives: [{ item: alternative, availability: "in_stock", checkedAt: new Date().toISOString() }] };
      const requests = [];
      await targetPage.route("**/api/checkout", async (route) => {
        const body = route.request().postDataJSON();
        requests.push(body);
        const count = requests.length;
        let result;
        if (count === 1) result = { status: "invalid_size", ...recovery, availableSizes: ["QA replacement size"], message: "QA: choose a newly offered size." };
        else if (count === 2) result = { status: "unverified", ...recovery, message: "QA: merchant verification is unavailable." };
        else if (count === 3) result = { status: "price_changed", message: "QA: review the changed price.", priceChanges: [{ pieceId: alternative.pieceId, pieceName: alternative.pieceName, productId: alternative.productId, oldCents: alternative.priceCents, newCents: alternative.priceCents + 101 }] };
        else result = { status: "error", message: "QA intentionally stops before payment." };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
      });
      await cart.getByRole("button", { name: "Checkout", exact: true }).click();
      await cart.locator('[data-checkout-recovery="invalid_size"]').waitFor();
      assert.equal(await targetPage.evaluate(() => document.activeElement?.getAttribute("aria-label")), `${target.pieceName}, needs attention`);
      assert.deepEqual((await storedCart(targetPage)).items.filter((item) => item.pieceId !== target.pieceId), unrelated);
      await cart.getByRole("button", { name: `Choose size QA replacement size for ${target.pieceName}`, exact: true }).click();
      await cart.getByRole("button", { name: "Checkout", exact: true }).click();
      await cart.locator('[data-checkout-recovery="unverified"]').waitFor();
      assert.equal((await storedCart(targetPage)).items.length, original.items.length);
      await cart.getByRole("button", { name: new RegExp(`^Replace with ${alternative.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
      assert.deepEqual((await storedCart(targetPage)).items.filter((item) => item.pieceId !== target.pieceId), unrelated);
      await cart.getByRole("button", { name: "Checkout", exact: true }).click();
      const accept = cart.getByRole("button", { name: "Accept prices and checkout", exact: true });
      await accept.waitFor();
      assert.equal(requests.length, 3, "A changed price waits for explicit acceptance");
      await accept.click();
      await cart.getByText("QA intentionally stops before payment.", { exact: true }).waitFor();
      assert.equal(requests[3].acceptedPrices.find((item) => item.pieceId === alternative.pieceId).priceCents, alternative.priceCents + 101);
      assert.equal(requests[3].items.find((item) => item.pieceId === alternative.pieceId).productId, alternative.productId);
      await targetPage.screenshot({ path: path.join(evidence, "cart-recovery-fixtures.png") });
      return { evidenceType: "browser UI with typed response fixtures", checkoutAttempts: requests.length, preservedOtherLines: unrelated.length, paymentSessions: 0 };
    } catch (error) {
      await targetPage.screenshot({ path: path.join(evidence, "cart-recovery-debug.png"), fullPage: true });
      await writeFile(path.join(evidence, "cart-recovery-debug.txt"), await targetPage.locator("body").innerText());
      throw error;
    } finally { await fresh.close(); }
  });

  await check("saved board validates products or reports unavailable signing configuration", async () => {
    const item = { pieceId: "screenshot-0", pieceName: "Black cape", sizeKind: "one_size", productId: "a".repeat(24),
      title: "QA black cape", productUrl: "https://www.etsy.com/listing/1234567890/qa-black-cape", image: "https://i.etsystatic.com/qa-cape.jpg",
      merchantId: "etsy.com", merchantName: "QA merchant", priceCents: 1000, availableSizes: [], size: null };
    const body = { requestId: "12345678-1234-4123-8123-123456789abc", name: "QA unsigned board", model: "female",
      pieces: [{ piece: { name: item.pieceName, slot: "outer", query: "black cape", sizeKind: item.sizeKind }, item }] };
    const submit = (value) => context.request.post(new URL("/api/saved-looks", base).href, { data: value, headers: { origin: base.origin } });
    const unsigned = await submit(body);
    const unsignedStatus = unsigned.status();
    const signingAvailable = unsignedStatus === 400;
    const unavailableMessage = "Saving this look is unavailable right now. Your found pieces remain on this board.";
    const unsignedBody = await unsigned.json();
    if (signingAvailable) assert.match(unsignedBody.error, /verified|invalid/i);
    else {
      assert.equal(unsignedStatus, 503);
      assert.equal(unsignedBody.error, unavailableMessage, "Missing signing configuration preserves found pieces with an explicit error");
    }
    const expectInvalidOrUnavailable = async (value) => {
      const response = await submit(value);
      assert.equal(response.status(), signingAvailable ? 400 : 503);
      if (!signingAvailable) assert.equal((await response.json()).error, unavailableMessage);
      return response.status();
    };
    const forged = structuredClone(body);
    forged.pieces[0].proof = "0".repeat(64);
    const forgedStatus = await expectInvalidOrUnavailable(forged);
    for (const unsafe of ["https://127.0.0.1/product", "https://localhost/product", "https://merchant.internal/product", "http://merchant.com/product", "https://user:pass@merchant.com/product", "https://merchant.com:444/product"]) {
      const changed = structuredClone(forged);
      changed.pieces[0].item.productUrl = unsafe;
      await expectInvalidOrUnavailable(changed);
    }
    const foreign = await context.request.post(new URL("/api/saved-looks", base).href, { data: body, headers: { origin: "https://untrusted.invalid" } });
    assert.equal(foreign.status(), 403);
    assert.equal((await context.request.get(new URL("/api/saved-looks/not-a-uuid", base).href)).status(), 404);
    return { signingConfiguration: signingAvailable ? "available" : "unavailable", unsignedStatus, forgedStatus,
      productValidation: signingAvailable ? "unsigned, forged, and six unsafe URL forms rejected" : "not exercised: signing configuration guard ran first",
      configurationGuardRequests: signingAvailable ? 0 : 8, unsafeUrlsRejected: signingAvailable ? 6 : 0, databaseWrites: 0 };
  });

  await check("event endpoint rejects private fields and cross-origin requests", async () => {
    const event = { version: 1, journeyId: "0123456789abcdef0123456789abcdef", sequence: 1, name: "view", properties: { source: "look", slug: "cosmic-cowboy", mode: "demo" } };
    const submit = (body, headers = {}) => context.request.post(new URL("/api/events", base).href, { data: body, headers: { origin: base.origin, ...headers } });
    assert.equal((await submit(event)).status(), 204);
    assert.equal((await submit({ ...event, properties: { ...event.properties, query: "private-search-sentinel" } })).status(), 400);
    assert.equal((await submit({ ...event, properties: { ...event.properties, photo: "private-photo-sentinel" } })).status(), 400);
    assert.equal((await submit(event, { origin: "https://untrusted.invalid" })).status(), 403);
    assert.equal((await context.request.post(new URL("/api/events", base).href, { data: event })).status(), 403);
    assert.equal((await submit({ private: "do-not-record" }, { dnt: "1" })).status(), 204);
    return { acceptedDemo: 1, rejectedPrivatePayloads: 2, rejectedOrigins: 2, doNotTrack: "honored" };
  });

  await check("preview rejects invalid selections before providers and clip stays disabled", async () => {
    const target = new URL("/api/try-on", base).href;
    const photo = { name: "synthetic.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64") };
    const submit = (fields, headers = {}) => context.request.post(target, { multipart: { photo, consent: "true", costumeSlug: "cosmic-cowboy", ...fields }, headers: { origin: base.origin, ...headers } });
    assert.equal((await context.request.post(target, { data: {}, headers: { origin: base.origin } })).status(), 400);
    assert.equal((await submit({ consent: "false" })).status(), 400);
    assert.equal((await submit({}, { origin: "https://untrusted.invalid" })).status(), 403);
    assert.equal((await submit({ savedLookId: "12345678-1234-4123-8123-123456789abc" })).status(), 400, "Curated and saved sources are mutually exclusive");
    assert.equal((await submit({ savedLookId: "not-a-uuid", costumeSlug: "" })).status(), 400);
    assert.equal((await submit({ selection: JSON.stringify([{ pieceId: "cowboy-hat", productId: "p-4b2c550c26" }]), ownedPieceIds: JSON.stringify(["cowboy-hat"]) })).status(), 400);
    assert.equal((await submit({ selection: JSON.stringify([{ pieceId: "invented-piece", productId: "invented-product" }]) })).status(), 400);
    const configuration = await context.request.get(new URL("/api/clip-costume", base).href);
    assert.equal(configuration.status(), 200);
    assert.deepEqual(await configuration.json(), { enabled: false });
    assert.equal((await context.request.post(new URL("/api/clip-costume", base).href, { data: {} })).status(), 503);
    return { invalidPreviewRequestsRejected: 7, providerCalls: 0, clipFlag: "disabled" };
  });

  await check("mobile campaign layout", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await navigate("/");
    await page.getByRole("combobox", { name: "Price" }).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Home must fit the phone viewport");
    await page.screenshot({ path: path.join(evidence, "discovery-mobile.png") });
    await navigate("/costumes/cosmic-cowboy");
    await page.getByRole("button", { name: /Copy look link|Copy link again/ }).waitFor();
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) => button.textContent === "Copy look link" && !button.disabled));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Costume must fit the phone viewport");
    await page.screenshot({ path: path.join(evidence, "selection-mobile.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  await check("browser campaign measurement uses one anonymous journey per context", async () => {
    const names = new Set(capturedEvents.map(({ payload }) => payload.name));
    for (const name of ["view", "filter", "cart_add", "checkout_start", "checkout_recovery"]) assert(names.has(name), `The browser must emit ${name}`);
    const allowed = new Set(["source", "slug", "durationMs", "stage", "provider", "units", "mode"]);
    const journeys = new Map();
    for (const { contextId, payload } of capturedEvents) {
      assert.match(payload.journeyId, /^[a-f0-9]{32}$/);
      for (const key of Object.keys(payload.properties)) assert(allowed.has(key), `Unexpected event property ${key}`);
      const ids = journeys.get(contextId) ?? new Set();
      ids.add(payload.journeyId); journeys.set(contextId, ids);
      assert.equal(ids.size, 1, "A browser context keeps one anonymous journey identifier");
      assert(!/private-search-sentinel|private-photo-sentinel|QA replacement size/.test(JSON.stringify(payload)));
    }
    await writeFile(path.join(evidence, "browser-events.json"), JSON.stringify(capturedEvents, null, 2) + "\n");
    return { eventCount: capturedEvents.length, names: [...names].sort(), browserJourneys: journeys.size };
  });

  await check("browser has no uncaught runtime errors", async () => assert.deepEqual(errors, []));
} finally {
  await context.close();
  await browser.close();
  await writeFile(path.join(evidence, "summary.json"), JSON.stringify({ base: base.href, results }, null, 2) + "\n");
  console.log(`Evidence: ${evidence}`);
}
if (results.some((result) => result.status === "failed")) process.exitCode = 1;
