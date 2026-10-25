// Real HTTP and provider calls. Run against a local server or the deployed demo.
// Example: bun scripts/verify-screenshot-sourcing.ts http://localhost:3401 --repeat --checkout
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { isBlockedDomain, isNoiseDomain } from "../lib/sourcing/blocklist";
import type { CartItem } from "../lib/types";

const base = process.argv.find((arg) => /^https?:/.test(arg)) ?? "http://localhost:3401";
const output = process.env.SCREENSHOT_EVIDENCE_DIR;
const samples = process.env.SCREENSHOT_SAMPLES?.split(",") ?? ["cosmic-cowboy", "velvet-vampire", "moon-moth", "linen-ghost", "woodland-mushroom"];
const repeat = process.argv.includes("--repeat");
const checkout = process.argv.includes("--checkout");
const strict = process.argv.includes("--require-complete");
if (output) await mkdir(output, { recursive: true });

type Event = { t: string; ms: number; kind?: string; cached?: boolean; pieces?: unknown[]; found?: number; item?: CartItem };
const summaries: object[] = [];
for (const slug of samples) {
  const image = await readFile(path.join(process.cwd(), "public/costumes", `${slug}.png`));
  for (let attempt = 0; attempt < (repeat ? 2 : 1); attempt++) {
    const form = new FormData();
    form.set("photo", new File([image], `${slug}.png`, { type: "image/png" }));
    const start = performance.now();
    const response = await fetch(`${base}/api/screenshot-costume`, { method: "POST", body: form, signal: AbortSignal.timeout(58_000) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/x-ndjson/);
    const text = await response.text();
    if (output) await writeFile(path.join(output, `${slug}-${attempt}.ndjson`), text);
    const events: Event[] = text.trim().split("\n").map((line) => JSON.parse(line));
    assert(!events.some((event) => event.t === "error"), `${slug}: sourcing failed`);
    const look = events.find((event) => event.t === "look");
    assert(look?.pieces?.length, `${slug}: missing image analysis`);
    const done = events.find((event) => event.t === "done");
    const items = events.filter((event) => event.t === "piece").map((event) => event.item!);
    assert.equal(done?.found, items.length);
    assert(items.length > 0, `${slug}: no verified products`);
    if (strict) assert.equal(items.length, look.pieces.length, `${slug}: incomplete look`);
    for (const item of items) {
      assert(item.title && item.merchantName && item.productUrl.startsWith("https://"));
      assert(!isBlockedDomain(item.productUrl) && !isNoiseDomain(item.productUrl));
      assert(item.image.startsWith("https://"));
      assert(Number.isSafeInteger(item.priceCents) && item.priceCents > 0);
      assert.equal(item.productId, createHash("sha256").update(item.productUrl).digest("hex").slice(0, 24));
    }
    const cached = events.some((event) => event.cached);
    if (cached) assert(!events.some((event) => event.kind === "search" || event.kind === "candidate"), "Replay must not fabricate a search trace");
    const summary = { slug, attempt, elapsedMs: Math.round(performance.now() - start), streamMs: done?.ms, found: items.length, requested: look.pieces.length,
      searches: events.filter((event) => event.kind === "search").length, cached };
    summaries.push(summary);
    console.log(JSON.stringify(summary));

    if (checkout && !attempt) {
      const key = process.env.STRIPE_SECRET_KEY;
      assert(key && key.startsWith("sk_test_"), "Checkout verification requires a test key");
      const stripe = new Stripe(key);
      const body = { costumeSlug: "screenshot-look", items: items.map((item) => ({ pieceId: item.pieceId, productId: item.productId,
        size: item.sizeKind === "one_size" ? null : item.availableSizes[0] ?? null,
        web: { url: item.productUrl, title: item.title, image: item.image, merchantName: item.merchantName, pieceName: item.pieceName, sizeKind: item.sizeKind },
      })), acceptedPrices: items.map((item) => ({ pieceId: item.pieceId, productId: item.productId, priceCents: item.priceCents })) };
      let response = await fetch(`${base}/api/checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      let result = await response.json();
      if (result.status === "price_changed") {
        for (const change of result.priceChanges) {
          const price = body.acceptedPrices.find((item) => item.pieceId === change.pieceId)!;
          price.priceCents = change.newCents;
        }
        response = await fetch(`${base}/api/checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        result = await response.json();
      }
      assert.equal(result.status, "ok", `${slug}: checkout: ${JSON.stringify(result)}`);
      const session = await stripe.checkout.sessions.retrieve(result.sessionId, { expand: ["line_items.data.price.product"] });
      try {
        assert.equal(session.livemode, false);
        assert.equal(session.line_items?.data.length, items.length);
        assert.equal(session.amount_total, body.acceptedPrices.reduce((sum, item) => sum + item.priceCents, 0));
        assert.equal(session.total_details?.amount_tax, 0);
        assert.equal(session.total_details?.amount_shipping, 0);
        for (const line of session.line_items!.data) {
          const product = line.price?.product as Stripe.Product;
          const item = items.find((item) => item.pieceId === product.metadata.piece_id)!;
          assert(item, "Checkout has an unknown product");
          assert.equal(product.metadata.merchant, item.merchantName);
          assert(product.metadata.product_url.startsWith("https://"));
          assert(product.metadata.size);
        }
        console.log(`${slug}: exact Stripe TEST checkout lines verified (${items.length}); expiring unpaid session`);
      } finally { await stripe.checkout.sessions.expire(session.id); }
    }
  }
}
for (const [options, expected] of [
  [{ method: "POST", headers: { "Content-Type": "text/plain" }, body: "not an image" }, 400],
  [{ method: "POST", headers: { Origin: "https://example.com" } }, 403],
] as const) {
  const response = await fetch(`${base}/api/screenshot-costume`, options);
  assert.equal(response.status, expected);
}
if (output) await writeFile(path.join(output, "summary.json"), JSON.stringify(summaries, null, 2));
console.log("Screenshot sourcing checks passed. No payment was made.");
