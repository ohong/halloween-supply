/** Real release checks for the five demo costumes. No payment is completed.
 * bun scripts/verify-costumes.ts https://halloween.supply [--checkout] [--all-options] [--chat]
 * --checkout creates and expires unpaid Stripe TEST sessions. --all-options checks all three pick sets.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import Stripe from "stripe";
import type { UIMessage } from "ai";
import type { ChatContext } from "../lib/ai/chat-context";
import type { CheckoutRequest, CheckoutResponse } from "../lib/checkout/types";
import type { CostumeSnapshot, CostumeView, ProductOption } from "../lib/types";
import { validateSnapshot } from "../lib/graph/validate";

// Next resolves this package at build time. Bun only needs its server modules here.
type BunRuntime = { plugin(plugin: { name: string; setup(build: { module(name: string, loader: () => unknown): void }): void }): void };
(globalThis as unknown as { Bun: BunRuntime }).Bun.plugin({
  name: "verification-server-modules",
  setup(build) { build.module("server-only", () => ({ exports: {}, loader: "object" })); },
});

const base = new URL(process.argv.find((argument) => /^https?:\/\//.test(argument)) ?? "http://127.0.0.1:3300").origin;
const slugs = ["cosmic-cowboy", "velvet-vampire", "moon-moth", "linen-ghost", "woodland-mushroom"];
const checkoutEnabled = process.argv.includes("--checkout");
const checks: string[] = [];
const pass = (name: string) => { checks.push(name); console.log(`PASS ${name}`); };
const decode = (html: string) => html.replaceAll("&amp;", "&").replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fetchedAssets = new Set<string>();

async function get(route: string, timeout = 60_000) {
  return fetch(new URL(route, base), { signal: AbortSignal.timeout(timeout), cache: "no-store" });
}
async function post(body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(new URL("/api/checkout", base), {
    method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90_000),
  });
  return { response, body: await response.json() as CheckoutResponse };
}
function productFor(snapshot: CostumeSnapshot, productId: string) {
  const product = snapshot.products.find((candidate) => candidate.id === productId);
  assert(product, `${snapshot.costume.slug}: missing catalog product ${productId}`);
  return product;
}
function selectedItems(snapshot: CostumeSnapshot, rank: number): CheckoutRequest["items"] {
  return snapshot.pieces.map((piece) => {
    const match = piece.matches.find((candidate) => candidate.rank === rank);
    assert(match, `${piece.id}: missing rank ${rank}`);
    const product = productFor(snapshot, match.productId);
    assert(piece.sizeKind === "one_size" || product.sizes.length > 0, `${piece.id}: no merchant size is recorded`);
    return { pieceId: piece.id, productId: product.id, size: piece.sizeKind === "one_size" ? null : product.sizes[0] };
  });
}

async function verifyAsset(publicPath: string, transparent = false) {
  assert(publicPath.startsWith("/products/"), `Expected a normalized local product image: ${publicPath}`);
  if (fetchedAssets.has(publicPath)) return;
  const local = await readFile(path.join(process.cwd(), "public", publicPath));
  const meta = await sharp(local).metadata();
  assert(Math.max(meta.width ?? 0, meta.height ?? 0) >= 500 && Math.min(meta.width ?? 0, meta.height ?? 0) >= 50, `Image is too small: ${publicPath}`);
  if (transparent) {
    assert.equal(meta.format, "png", `Cutout must be PNG: ${publicPath}`);
    assert(meta.hasAlpha, `Cutout needs an alpha channel: ${publicPath}`);
    const stats = await sharp(local).stats();
    const alpha = stats.channels[stats.channels.length - 1];
    assert(alpha.min === 0 && alpha.max > 0, `Cutout must contain both transparent background and a visible product: ${publicPath}`);
  }
  const response = await get(publicPath);
  assert.equal(response.status, 200, `Public image failed: ${publicPath}`);
  assert(response.headers.get("content-type")?.startsWith("image/"), `Not an image response: ${publicPath}`);
  assert.equal(digest(new Uint8Array(await response.arrayBuffer())), digest(local), `Deployed image differs from reviewed asset: ${publicPath}`);
  fetchedAssets.add(publicPath);
}

function identity(view: CostumeView | null) {
  if (!view) return null;
  return {
    slug: view.costume.slug,
    pieces: view.pieces.map(({ piece, options }) => ({
      pieceId: piece.id, order: piece.order,
      options: options.map((option) => ({
        productId: option.product.id, merchantId: option.merchant.id, rank: option.pick.rank,
        priceCents: option.product.priceCents, url: option.product.url, image: option.product.image,
      })),
    })),
  };
}
const optionIdentity = (options: ProductOption[]) => options.map((option) => ({
  productId: option.product.id, pieceId: option.pick.pieceId, merchantId: option.merchant.id,
  rank: option.pick.rank, priceCents: option.product.priceCents,
}));

async function verifyCatalogSelection(snapshots: CostumeSnapshot[]) {
  const catalog = await import("../lib/catalog");
  const snapshotImpl = await import("../lib/graph/snapshot");
  const graphImpl = await import("../lib/graph/queries");
  const { resetGraph } = await import("../lib/graph/client");
  const graphUrl = process.env.FALKORDB_URL;
  try {
    // This exercises the actual data-access fallback, without inventing provider data.
    await resetGraph();
    delete process.env.FALKORDB_URL;
    for (const snapshot of snapshots) {
      const view = await catalog.getCostume(snapshot.costume.slug);
      assert(view && view.pieces.length === 5, `${snapshot.costume.slug}: snapshot fallback is incomplete`);
      assert.equal(catalog.getCatalogSource(), "snapshot");
      assert.deepEqual(identity(view), identity(await snapshotImpl.getCostume(snapshot.costume.slug)));
    }
    assert.equal(await catalog.getCostume("unknown-costume"), null);
    pass("all five use the committed catalog when FalkorDB is unconfigured; unknown costumes stay missing");
  } finally {
    if (graphUrl === undefined) delete process.env.FALKORDB_URL;
    else process.env.FALKORDB_URL = graphUrl;
  }
  if (!graphUrl) throw new Error("FALKORDB_URL is needed to verify the real graph and snapshot parity.");
  try {
    for (const snapshot of snapshots) {
      const slug = snapshot.costume.slug;
      const graphView = await graphImpl.getCostume(slug);
      assert.deepEqual(identity(graphView), identity(await snapshotImpl.getCostume(slug)), `${slug}: graph and snapshot differ`);
      const catalogView = await catalog.getCostume(slug);
      assert.deepEqual(identity(catalogView), identity(graphView));
      assert.equal(catalog.getCatalogSource(), "graph", `${slug}: a warm graph read must use FalkorDB`);
      for (const piece of snapshot.pieces) {
        for (const filters of [{ costumeSlug: slug }, { costumeSlug: slug, localOnly: true }, { costumeSlug: slug, maxPriceCents: 10_000 }]) {
          assert.deepEqual(optionIdentity(await graphImpl.getAlternatives(piece.id, filters)), optionIdentity(await snapshotImpl.getAlternatives(piece.id, filters)), `${slug}/${piece.id}: alternatives differ`);
        }
      }
      for (const merchant of snapshot.merchants) {
        assert.deepEqual(optionIdentity(await graphImpl.getMerchantCatalog(merchant.id, slug)), optionIdentity(await snapshotImpl.getMerchantCatalog(merchant.id, slug)), `${slug}: merchant catalog differs`);
      }
      const ids = selectedItems(snapshot, 0).map((item) => item.productId);
      assert.deepEqual(await graphImpl.getFewestShops(ids), await snapshotImpl.getFewestShops(ids), `${slug}: fewest-shops differs`);
      pass(`${slug}: real FalkorDB selection, complete picks, alternatives, filters, merchants and fewest-shops match the snapshot`);
    }
  } finally {
    await resetGraph();
  }
}

async function verifyCheckout(snapshot: CostumeSnapshot, stripe: Stripe, rank: number) {
  const items = selectedItems(snapshot, rank);
  const expectedPrices = new Map(items.map((item) => [item.pieceId, productFor(snapshot, item.productId).priceCents]));
  let result = await post({ costumeSlug: snapshot.costume.slug, items });
  // Acknowledgment is sent only after the server reports the changed merchant amounts.
  for (let attempt = 0; result.body.status === "price_changed" && attempt < 2; attempt++) {
    for (const change of result.body.priceChanges) expectedPrices.set(change.pieceId, change.newCents);
    result = await post({ costumeSlug: snapshot.costume.slug, items,
      acceptedPrices: items.map((item) => ({ ...item, priceCents: expectedPrices.get(item.pieceId) })),
    });
  }
  assert.equal(result.body.status, "ok", `${snapshot.costume.slug} rank ${rank}: ${"message" in result.body ? result.body.message : result.body.status}`);
  assert(result.body.status === "ok");
  assert(result.body.sessionId.startsWith("cs_test_"), "Checkout must create a TEST session.");
  const id = result.body.sessionId;
  try {
    const session = await stripe.checkout.sessions.retrieve(id);
    assert.equal(session.livemode, false, "Never test a live Stripe session.");
    assert.equal(session.mode, "payment");
    assert.equal(session.status, "open");
    assert.equal(session.payment_status, "unpaid");
    assert.equal(session.customer_creation, "if_required");
    assert.equal(session.currency, "usd");
    assert.equal(session.metadata?.costume, snapshot.costume.slug);
    assert.deepEqual(session.shipping_address_collection?.allowed_countries, ["US"]);
    assert.equal(session.automatic_tax?.enabled, false);
    assert.equal(session.amount_subtotal, session.amount_total, "No fee, tax or shipping amount may be added.");
    assert.equal(session.total_details?.amount_shipping, 0);
    assert.equal(session.total_details?.amount_tax, 0);
    assert.equal(session.cancel_url, new URL(`/costumes/${snapshot.costume.slug}`, base).toString());
    assert.equal(session.success_url, new URL("/success?session_id={CHECKOUT_SESSION_ID}", base).toString());
    const lines = await stripe.checkout.sessions.listLineItems(id, { expand: ["data.price.product"], limit: 100 });
    assert.equal(lines.data.length, 5);
    assert.equal(lines.has_more, false);
    const seenPieces = new Set<string>();
    for (const line of lines.data) {
      const product = line.price?.product;
      assert(product && typeof product !== "string" && !("deleted" in product), "Each line must expand its product.");
      assert.equal(product.livemode, false);
      const item = items.find((candidate) => candidate.pieceId === product.metadata.piece_id);
      assert(item, "Line has no matching piece metadata.");
      assert(!seenPieces.has(item.pieceId), "A Stripe piece is duplicated.");
      seenPieces.add(item.pieceId);
      const original = productFor(snapshot, item.productId);
      const merchant = snapshot.merchants.find((candidate) => candidate.id === original.merchantId)!;
      assert(product.name.includes(original.title), "Stripe product name must identify the merchant product.");
      assert.equal(product.metadata.product_id, original.id);
      assert.equal(product.metadata.merchant_id, merchant.id);
      assert.equal(product.metadata.merchant, merchant.name);
      assert.equal(product.metadata.size, item.size ?? "one size");
      assert(Number.isFinite(Date.parse(product.metadata.verified_at)), "Each line needs a real verification timestamp.");
      const exactUrl = new URL(product.metadata.product_url);
      const recordedUrl = new URL(original.url);
      assert.equal(exactUrl.origin, recordedUrl.origin);
      assert.equal(exactUrl.pathname, recordedUrl.pathname);
      for (const [key, value] of recordedUrl.searchParams) {
        if (key !== "variant") assert.equal(exactUrl.searchParams.get(key), value);
      }
      if (recordedUrl.searchParams.has("variant")) assert(product.metadata.variant_id, "Pinned merchant variants need a fulfillment variant ID.");
      if (product.metadata.variant_id) {
        assert(/^\d+$/.test(product.metadata.variant_id));
        assert.equal(exactUrl.searchParams.get("variant"), product.metadata.variant_id);
      }
      assert.equal(line.quantity, 1);
      assert.equal(line.currency, "usd");
      assert.equal(line.price?.unit_amount, expectedPrices.get(item.pieceId));
      assert.equal(line.amount_subtotal, line.price?.unit_amount);
      assert.equal(line.amount_total, line.price?.unit_amount);
    }
    assert.equal(session.amount_total, lines.data.reduce((sum, line) => sum + line.amount_total, 0));
    const recordedLines = Object.entries(session.metadata ?? {}).filter(([name]) => /^item_\d+$/.test(name)).map(([, value]) => JSON.parse(value) as { piece: string; merchant: string; url: string; size: string; cents: number });
    assert.equal(recordedLines.length, 5, "Session needs fulfillment details for each piece.");
    assert.equal(recordedLines.reduce((sum, line) => sum + line.cents, 0), session.amount_total);
    assert.deepEqual(new Set(recordedLines.map((line) => line.piece)), seenPieces);
    for (const recorded of recordedLines) {
      const line = lines.data.find((candidate) => (candidate.price?.product as Stripe.Product).metadata.piece_id === recorded.piece);
      assert(line);
      const product = line.price?.product as Stripe.Product;
      assert.equal(recorded.merchant, product.metadata.merchant);
      assert.equal(recorded.url, product.metadata.product_url);
      assert.equal(recorded.size, product.metadata.size);
      assert.equal(recorded.cents, line.price?.unit_amount);
    }
    pass(`${snapshot.costume.slug} rank ${rank}: Stripe TEST has five exact merchant-price lines, product/variant/size metadata, US address collection and total ${session.amount_total} cents`);
  } finally {
    const session = await stripe.checkout.sessions.retrieve(id);
    assert.equal(session.livemode, false);
    assert.equal(session.payment_status, "unpaid");
    if (session.status === "open") await stripe.checkout.sessions.expire(id);
    assert.equal((await stripe.checkout.sessions.retrieve(id)).status, "expired");
    pass(`${snapshot.costume.slug} rank ${rank}: unpaid TEST session expired`);
  }
}

async function verifyChat(snapshot: CostumeSnapshot, foreignSnapshot: CostumeSnapshot) {
  const context: ChatContext = { costumeSlug: snapshot.costume.slug, cart: [], sizes: {} };
  const user = (text: string): UIMessage => ({ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] });
  const request = (messages: UIMessage[], ctx = context) => fetch(new URL("/api/chat", base), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, context: ctx }), signal: AbortSignal.timeout(70_000),
  });
  const foreign = foreignSnapshot.pieces.flatMap((piece) => piece.matches.map((match) => ({ pieceId: piece.id, productId: match.productId, size: null }))).find((item) => !snapshot.pieces.some((piece) => piece.id === item.pieceId && piece.matches.some((match) => match.productId === item.productId)));
  assert(foreign, "Need a foreign catalog item to verify costume isolation.");
  assert.equal((await request([user("What is in my cart?")], { ...context, cart: [foreign] })).status, 400);
  const response = await request([user(`Call getCostume to show the complete ${snapshot.costume.name}. Then call getAlternatives for piece ${snapshot.pieces[0].id}. Use the recorded catalog only.`)]);
  assert.equal(response.status, 200);
  assert(response.headers.get("content-type")?.includes("text/event-stream"));
  const events = (await response.text()).split("\n").filter((line) => line.startsWith("data: ") && line !== "data: [DONE]").map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
  assert(!events.some((event) => event.type === "error"), `${snapshot.costume.slug}: provider stream failed`);
  for (const toolName of ["getCostume", "getAlternatives"]) {
    const call = events.find((event) => event.type === "tool-input-available" && event.toolName === toolName);
    assert(call, `${snapshot.costume.slug}: real assistant did not call ${toolName}`);
    const output = events.find((event) => event.type === "tool-output-available" && event.toolCallId === call.toolCallId)?.output as Record<string, unknown> | undefined;
    assert(output, `${toolName}: no real catalog output`);
    const cards = toolName === "getCostume"
      ? (output.pieces as Array<{ options: Array<{ productId: string }> }>).flatMap((piece) => piece.options)
      : output.products as Array<{ productId: string }>;
    assert(cards.length >= 3);
    const realIds = new Set(snapshot.products.map((product) => product.id));
    assert(cards.every((card) => realIds.has(card.productId)), "Assistant leaked a product from another costume.");
  }
  pass(`${snapshot.costume.slug}: real Anthropic catalog/alternatives tools return scoped products; foreign-cart products are rejected`);
}

async function main() {
  if (checkoutEnabled) assert(process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"), "STRIPE_SECRET_KEY must be a TEST key before verification creates any session.");
  const snapshots = await Promise.all(slugs.map(async (slug) => validateSnapshot(JSON.parse(await readFile(`data/costumes/${slug}.json`, "utf8")))));
  const homeResponse = await get("/");
  assert.equal(homeResponse.status, 200);
  const home = decode(await homeResponse.text());
  for (const snapshot of snapshots) {
    const { slug } = snapshot.costume;
    assert.equal(snapshot.costume.status, "live");
    assert.equal(snapshot.pieces.length, 5);
    assert(home.includes(`/costumes/${slug}`), `Home must link to ${slug}`);
    const response = await get(`/costumes/${slug}`);
    assert.equal(response.status, 200, `${slug}: costume page failed`);
    const html = decode(await response.text());
    assert(html.includes("Add whole costume") && html.includes("Why this pick") && html.includes("Swap"));
    assert.equal(snapshot.costume.image, `/products/${slug}-flatlay.jpg`);
    assert(html.includes(snapshot.costume.image), `${slug}: page does not use its real flat-lay`);
    await verifyAsset(snapshot.costume.image);
    for (const piece of snapshot.pieces) {
      assert.deepEqual(piece.matches.map((match) => match.rank).sort(), [0, 1, 2]);
      assert.equal(new Set(piece.matches.map((match) => match.productId)).size, 3);
      for (const match of piece.matches) {
        const product = productFor(snapshot, match.productId);
        await verifyAsset(product.image);
        assert(product.cutout, `${slug}/${piece.id}: every swap needs a transparent cutout`);
        await verifyAsset(product.cutout, true);
        if (match.rank === 0) {
          assert.equal(product.availability, "in_stock");
          assert(html.includes(product.title), `${slug}: page is missing ${product.id}`);
          const merchant = snapshot.merchants.find((candidate) => candidate.id === product.merchantId)!;
          assert(html.includes(merchant.name), `${slug}: page is missing its merchant`);
        }
      }
    }
    const items = selectedItems(snapshot, 0);
    const noSizes = await post({ costumeSlug: slug, items: items.map((item) => ({ ...item, size: null })) });
    assert.equal(noSizes.body.status, "needs_sizes");
    assert.equal((await post({ costumeSlug: slug, items: [items[0], items[0]] })).response.status, 400);
    assert.equal((await post({ costumeSlug: slug, items: [{ ...items[0], productId: "not-a-catalog-product" }] })).response.status, 400);
    pass(`${slug}: five pieces, three real options each, complete flat-lay, default transparent cutouts, merchant HTML and safe checkout validation`);
  }
  assert(!/coming soon/i.test(home), "All five demo costumes should be live.");
  const healthResponse = await get("/api/health");
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  for (const name of ["ANTHROPIC_API_KEY", "BRIGHTDATA_API_KEY", "BRIGHTDATA_SERP_ZONE", "BRIGHTDATA_UNLOCKER_ZONE", "FALKORDB_URL", "STRIPE_SECRET_KEY", "CRON_SECRET"]) assert.equal(health.env[name], true, `Missing server credential: ${name}`);
  assert.equal(health.env.STRIPE_SECRET_KEY_IS_TEST, true, "Deployed checkout must stay in TEST mode.");
  assert.equal(health.graph.ok, true, "The deployed server must reach FalkorDB.");
  const catalogHealth = health.catalogs ?? health.costumes ?? (Array.isArray(health.catalog) ? health.catalog : null);
  assert(Array.isArray(catalogHealth), "Health must report every live costume.");
  for (const slug of slugs) {
    const entry = catalogHealth.find((catalog) => catalog.slug === slug || catalog.costumeSlug === slug);
    assert(entry?.complete && entry.pieces === 5 && entry.products >= 15, `${slug}: deployed catalog health is incomplete`);
    assert(entry.source === "graph" || entry.source === "snapshot", `${slug}: catalog source must be explicit`);
  }
  assert.equal((await post({})).response.status, 400);
  assert.equal((await post({ costumeSlug: slugs[0], items: selectedItems(snapshots[0], 0) }, { Origin: "https://unrelated.example" })).response.status, 403);
  assert.equal((await get("/api/cron/refresh")).status, 401);
  pass("all five server catalogs healthy; credentials present by name; Stripe remains TEST; foreign origin and unauthenticated cron are rejected");
  await verifyCatalogSelection(snapshots);
  if (checkoutEnabled) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    for (const snapshot of snapshots) for (const rank of process.argv.includes("--all-options") ? [0, 1, 2] : [0]) await verifyCheckout(snapshot, stripe, rank);
  }
  if (process.argv.includes("--chat")) for (let i = 0; i < snapshots.length; i++) await verifyChat(snapshots[i], snapshots[(i + 1) % snapshots.length]);
  console.log(`${checks.length} checks passed against ${base}; ${fetchedAssets.size} reviewed public images matched.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Verification failed"); process.exitCode = 1; });
