// Stripe webhook route checks that need no provider: a missing or bad signature gets 400 before any
// database or Stripe call. Start the app with STRIPE_SECRET_KEY (sk_test_) and STRIPE_WEBHOOK_SECRET set.
//
// Full flow (Stripe test mode, local database; never use the production TURSO_* values):
//   1. turso dev --port 8081 --db-file <scratch>/orders.db
//   2. Start the app with TURSO_DATABASE_URL=http://127.0.0.1:8081 TURSO_AUTH_TOKEN=local and
//      STRIPE_WEBHOOK_SECRET=$(stripe listen --api-key "$STRIPE_SECRET_KEY" --print-secret)
//   3. stripe listen --api-key "$STRIPE_SECRET_KEY" --forward-to localhost:3000/api/webhooks/stripe
//   4. stripe trigger checkout.session.completed --api-key "$STRIPE_SECRET_KEY"
//      Expect 200 and one row in orders. `stripe events resend <id> --api-key ...` must leave one row
//      and an unchanged receipt_requested_at. Stop the database and resend: expect 500.
import assert from "node:assert/strict";

const origin = process.argv[2];
if (!origin) throw new Error("Usage: bun e2e/verify-stripe-webhook.ts <url>");
const endpoint = new URL("/api/webhooks/stripe", origin);
const body = JSON.stringify({ id: "evt_fake", object: "event", type: "checkout.session.completed", data: { object: {} } });
let checks = 0;

async function post(headers: Record<string, string>, method = "POST") {
  const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json", ...headers }, body: method === "POST" ? body : undefined });
  await response.text();
  return response.status;
}

assert.equal(await post({}), 400, "no signature"); checks++;
assert.equal(await post({ "Stripe-Signature": "t=1,v1=deadbeef" }), 400, "bad signature"); checks++;
assert.equal(await post({ "Stripe-Signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}` }), 400, "well-formed wrong signature"); checks++;
assert.equal(await post({}, "GET"), 405, "GET not allowed"); checks++;
console.log(`stripe webhook: ${checks} checks passed`);
