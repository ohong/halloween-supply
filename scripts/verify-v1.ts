// Run against a running production build or the deployed site. No payment is made.
// bun scripts/verify-v1.ts https://halloween.supply [--checkout] [--all-options] [--allow-database-down]
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import Stripe from "stripe";
import snapshotJson from "../data/costumes/cosmic-cowboy.json";
import { isBlockedDomain, isNoiseDomain } from "../lib/sourcing/blocklist";
import type { CostumeSnapshot } from "../lib/types";

const snapshot = snapshotJson as CostumeSnapshot;
const base = process.argv.find((arg) => /^https?:\/\//.test(arg)) ?? "http://localhost:3000";
const allowDatabaseDown = process.argv.includes("--allow-database-down");
const checks: string[] = [];
const pass = (name: string) => { checks.push(name); console.log(`PASS ${name}`); };

async function jsonPost(route: string, body: unknown) {
  const response = await fetch(new URL(route, base), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90_000),
  });
  return { response, body: await response.json() };
}

async function main() {
  assert.equal(snapshot.pieces.length, 5);
  for (const piece of snapshot.pieces) {
    assert.deepEqual(piece.matches.map((match) => match.rank).sort(), [0, 1, 2], piece.id);
    for (const match of piece.matches) {
      const product = snapshot.products.find((item) => item.id === match.productId);
      assert(product, `Missing ${match.productId}`);
      assert(Number.isSafeInteger(product.priceCents) && product.priceCents > 0);
      assert(!isBlockedDomain(product.url) && !isNoiseDomain(product.url), product.url);
      assert(snapshot.merchants.some((merchant) => merchant.id === product.merchantId));
      assert(product.image && product.checkedAt && match.reason);
      if (product.image.startsWith("/")) await access(path.join(process.cwd(), "public", product.image));
    }
  }
  pass("five pieces, three real merchant products each, valid prices and images");

  const homeResponse = await fetch(base, { signal: AbortSignal.timeout(30_000) });
  assert.equal(homeResponse.status, 200);
  const home = await homeResponse.text();
  assert(home.includes("cosmic-cowboy") && !/coming soon/i.test(home));
  pass("home renders the live demo costumes");

  const costumeResponse = await fetch(new URL(`/costumes/${snapshot.costume.slug}`, base), { signal: AbortSignal.timeout(30_000) });
  assert.equal(costumeResponse.status, 200);
  const html = await costumeResponse.text();
  const text = html.replaceAll("&amp;", "&").replaceAll("&#x27;", "'").replaceAll("&quot;", '"');
  for (const piece of snapshot.pieces) {
    const product = snapshot.products.find((item) => item.id === piece.matches.find((match) => match.rank === 0)?.productId)!;
    assert(text.includes(product.title), `Page missing default ${product.title}`);
    const merchant = snapshot.merchants.find((item) => item.id === product.merchantId)!;
    assert(text.includes(merchant.name), `Page missing merchant ${merchant.name}`);
  }
  assert(/Add whole costume/.test(html) && /Change/.test(html));
  pass("costume HTML renders merchant picks, product changes, whole-costume cart action");

  const health = await (await fetch(new URL("/api/health", base))).json();
  const databaseUp = Boolean(health.database.ok && health.catalog.complete);
  if (!databaseUp && allowDatabaseDown) {
    assert.equal(health.status, "degraded", "Health must report degraded while the database is down");
    assert.equal(health.catalogSource, "snapshot", "Database down must fall back to the snapshot");
    console.warn("WARN Turso unreachable or unseeded; continuing on snapshot fallback (--allow-database-down)");
  } else assert(databaseUp, "Database must connect and contain the complete cowboy catalog (pass --allow-database-down to verify fallback only)");
  for (const key of ["ANTHROPIC_API_KEY", "FIRECRAWL_API_KEY", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "STRIPE_SECRET_KEY"]) {
    assert.equal(health.env[key], true, `Missing server ${key}`);
  }
  pass(databaseUp ? "server credentials present by name; Turso reachable and seeded" : "server credentials present by name; Turso DOWN (degraded, snapshot fallback)");

  const malformed = await jsonPost("/api/checkout", {});
  assert.equal(malformed.response.status, 400);
  const items = snapshot.pieces.map((piece) => {
    const product = snapshot.products.find((item) => item.id === piece.matches.find((match) => match.rank === 0)?.productId)!;
    return { pieceId: piece.id, productId: product.id, size: null };
  });
  const missingSizes = await jsonPost("/api/checkout", { costumeSlug: snapshot.costume.slug, items });
  assert.equal(missingSizes.body.status, "needs_sizes");
  const duplicate = await jsonPost("/api/checkout", { costumeSlug: snapshot.costume.slug, items: [items[0], items[0]] });
  assert.equal(duplicate.response.status, 400);
  const forged = await jsonPost("/api/checkout", { costumeSlug: snapshot.costume.slug, items: [{ ...items[0], productId: "not-a-catalog-product" }] });
  assert.equal(forged.response.status, 400);
  const wrongSize = await jsonPost("/api/checkout", { costumeSlug: snapshot.costume.slug, items: [{ ...items[0], size: "not-a-real-size" }] });
  assert.equal(wrongSize.body.status, "invalid_size");
  const foreignOrigin = await fetch(new URL("/api/checkout", base), {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://unrelated.example" },
    body: JSON.stringify({ costumeSlug: snapshot.costume.slug, items }),
  });
  assert.equal(foreignOrigin.status, 403);
  assert.equal((await fetch(new URL("/api/cron/refresh", base))).status, 401);
  pass("checkout rejects malformed, duplicate, unknown products, invalid sizes and foreign origins; cron rejects missing authorization");

  if (process.argv.includes("--checkout")) {
    const key = process.env.STRIPE_SECRET_KEY;
    assert(key, "STRIPE_SECRET_KEY required to inspect the real unpaid session");
    for (const rank of process.argv.includes("--all-options") ? [0, 1, 2] : [0]) {
      const selected = snapshot.pieces.map((piece) => ({ pieceId: piece.id, productId: piece.matches.find((match) => match.rank === rank)!.productId }));
      const sized = selected.map((item) => {
        const product = snapshot.products.find((candidate) => candidate.id === item.productId)!;
        const piece = snapshot.pieces.find((candidate) => candidate.id === item.pieceId)!;
        return { ...item, size: piece.sizeKind === "one_size" ? null : product.sizes[0] ?? "M" };
      });
      const expectedPrices = new Map(sized.map((item) => [item.pieceId, snapshot.products.find((product) => product.id === item.productId)!.priceCents]));
      let result = await jsonPost("/api/checkout", { costumeSlug: snapshot.costume.slug, items: sized });
      if (result.body.status === "price_changed") {
        for (const change of result.body.priceChanges) expectedPrices.set(change.pieceId, change.newCents);
        result = await jsonPost("/api/checkout", {
          costumeSlug: snapshot.costume.slug, items: sized,
          acceptedPrices: result.body.priceChanges.map((change: { pieceId: string; productId: string; newCents: number }) => ({ pieceId: change.pieceId, productId: change.productId, priceCents: change.newCents })),
        });
      }
      assert.equal(result.body.status, "ok", `Live checkout blocked: ${result.body.message ?? result.body.status}`);
      const stripe: Stripe = new Stripe(key);
      const session = await stripe.checkout.sessions.retrieve(result.body.sessionId);
      try {
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { expand: ["data.price.product"], limit: 100 });
        assert.equal(lineItems.data.length, sized.length);
        assert.equal(session.amount_total, lineItems.data.reduce((sum, line) => sum + line.amount_total, 0));
        assert.deepEqual(session.shipping_address_collection?.allowed_countries, ["US"]);
        assert.equal(session.mode, "payment");
        assert.equal(session.payment_status, "unpaid");
        assert.equal(session.metadata?.costume, snapshot.costume.slug);
        for (const line of lineItems.data) {
          const product = line.price?.product as Stripe.Product;
          const item = sized.find((candidate) => candidate.pieceId === product.metadata.piece_id);
          assert(item, "Missing piece metadata");
          const original = snapshot.products.find((candidate) => candidate.id === item.productId)!;
          const merchant = snapshot.merchants.find((candidate) => candidate.id === original.merchantId)!;
          assert.equal(product.metadata.merchant, merchant.name);
          assert.equal(product.metadata.product_url, original.url);
          assert.equal(product.metadata.size, item.size ?? "one size");
          assert.equal(line.quantity, 1);
          assert.equal(line.currency, "usd");
          assert.equal(line.amount_total, line.price?.unit_amount);
          assert.equal(line.price?.unit_amount, expectedPrices.get(item.pieceId));
          assert(!product.metadata.price_unverified || product.metadata.price_unverified === "false");
        }
        pass(`real Stripe session, option set ${rank}: ${sized.length} exact merchant-price lines, fulfillment metadata, US shipping, sum ${session.amount_total} cents`);
      } finally {
        await stripe.checkout.sessions.expire(session.id);
        pass("verification session expired unpaid; no charge made");
      }
    }
  }
  console.log(`${checks.length} checks passed against ${new URL(base).origin}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Verification failed"); process.exitCode = 1; });
