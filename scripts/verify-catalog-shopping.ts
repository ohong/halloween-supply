/** Four recovered costume flows against a running app. --checkout creates and expires unpaid Stripe TEST sessions. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import Stripe from "stripe";
import type { CostumeSnapshot } from "../lib/types";
import type { CheckoutResponse, CheckoutRequest } from "../lib/checkout/types";

const base = new URL(process.argv.find((arg) => /^https?:/.test(arg)) ?? "http://localhost:3100");
const checkout = process.argv.includes("--checkout");
if (checkout) assert(process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"), "Only Stripe TEST sessions are permitted");
const stripe = checkout ? new Stripe(process.env.STRIPE_SECRET_KEY!) : null;
const browser = await chromium.launch();
let sessions = 0;
try {
  for (const slug of ["jellyfish-bloom", "venus-flytrap", "walking-thundercloud", "silent-film-star"]) {
    const snapshot: CostumeSnapshot = JSON.parse(await readFile(`data/costumes/${slug}.json`, "utf8"));
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const navigation = await page.goto(new URL(`/costumes/${slug}`, base).href);
      assert.equal(navigation?.status(), 200);
      await page.getByRole("heading", { name: snapshot.costume.name, exact: true }).waitFor();
      assert.equal(await page.locator(".outfit-piece:visible").count(), snapshot.pieces.length);
      for (const piece of snapshot.pieces) {
        await page.getByRole("button", { name: `Change ${piece.name}`, exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        assert.equal(await dialog.locator('[aria-label^="Price tier "]').count(), 3, `${piece.id}: three price tiers must be visible`);
        for (const tier of [1, 2, 3]) assert.equal(await dialog.locator(`[aria-label="Price tier ${tier} of 3"]`).count(), 1);
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
      }
      await page.getByRole("button", { name: "Add costume to cart", exact: true }).click();
      const cart = page.getByRole("dialog", { name: "Cart", exact: true });
      await cart.waitFor();
      assert.equal(await cart.locator(".cart-line").count(), snapshot.pieces.length);
      assert(await cart.getByRole("button", { name: "Checkout", exact: true }).isEnabled());
      console.log(`PASS ${slug}: every piece has three visible price tiers; the complete look adds to a ready cart`);
      if (!stripe) continue;
      const items: CheckoutRequest["items"] = snapshot.pieces.map((piece) => {
        const match = piece.matches.find(({ rank }) => rank === 0)!;
        const product = snapshot.products.find(({ id }) => id === match.productId)!;
        const size = piece.sizeKind === "one_size" ? null : product.sizes[0];
        assert(size !== undefined, `${piece.id}: a merchant size must exist`);
        return { pieceId: piece.id, productId: product.id, size };
      });
      let body: CheckoutResponse | undefined;
      let acceptedPrices: CheckoutRequest["acceptedPrices"];
      const prices = new Map(snapshot.products.map(({ id, priceCents }) => [id, priceCents]));
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await context.request.post(new URL("/api/checkout", base).href, { data: { costumeSlug: slug, items, ...(acceptedPrices ? { acceptedPrices } : {}) }, timeout: 90_000 });
        body = await response.json() as CheckoutResponse;
        if (body.status !== "price_changed") break;
        for (const change of body.priceChanges) prices.set(change.productId, change.newCents);
        acceptedPrices = items.map((item) => ({ pieceId: item.pieceId, productId: item.productId, priceCents: prices.get(item.productId)! }));
      }
      assert(body?.status === "ok", `${slug}: checkout failed: ${JSON.stringify(body)}`);
      const id = body.sessionId;
      assert(id.startsWith("cs_test_"));
      try {
        const session = await stripe.checkout.sessions.retrieve(id);
        assert.equal(session.livemode, false);
        assert.equal(session.payment_status, "unpaid");
        const lines = await stripe.checkout.sessions.listLineItems(id, { limit: 100, expand: ["data.price.product"] });
        assert.equal(lines.data.length, snapshot.pieces.length);
        for (const line of lines.data) {
          const product = line.price?.product as Stripe.Product;
          const item = items.find((item) => item.productId === product.metadata.product_id);
          assert(item, "A Stripe line must identify a selected catalog item");
          const original = snapshot.products.find(({ id }) => id === item.productId)!;
          const pinned = new URL(original.url).searchParams.get("variant");
          if (pinned && item.size === null) assert.equal(product.metadata.variant_id, pinned, "A one-size item must keep its pinned pack or length");
          assert.equal(line.quantity, 1);
          assert.equal(line.currency, "usd");
        }
        sessions++;
        console.log(`PASS ${slug}: an unpaid TEST checkout has ${lines.data.length} exact product lines`);
      } finally {
        const session = await stripe.checkout.sessions.retrieve(id);
        assert(!session.livemode && session.payment_status === "unpaid");
        if (session.status === "open") await stripe.checkout.sessions.expire(id);
        assert.equal((await stripe.checkout.sessions.retrieve(id)).status, "expired");
      }
    } finally { await context.close(); }
  }
  console.log(`PASS four shopping flows; ${sessions} unpaid TEST sessions verified and expired`);
} finally { await browser.close(); }
