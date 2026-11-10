import "server-only";

import type Stripe from "stripe";
import { getDatabase } from "../db/client";
import { getStripe } from "../checkout/stripe";

let schema: Promise<void> | undefined;

async function ensureSchema() {
  if (!schema) {
    const db = getDatabase();
    schema = db.batch([
      `CREATE TABLE IF NOT EXISTS orders (
        stripe_session_id TEXT PRIMARY KEY,
        payment_intent_id TEXT,
        livemode INTEGER NOT NULL,
        costume TEXT,
        amount_total_cents INTEGER NOT NULL,
        currency TEXT NOT NULL,
        customer_email TEXT,
        shipping_json TEXT,
        lines_json TEXT NOT NULL,
        fulfillment_status TEXT NOT NULL DEFAULT 'pending',
        receipt_requested_at TEXT,
        created_at TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS orders_fulfillment_status ON orders (fulfillment_status)",
    ]).then(() => undefined).catch((error) => { schema = undefined; throw error; });
  }
  return schema;
}

/** Product metadata set at checkout creation; the session `item_N` metadata can be clipped. */
async function readLines(stripe: Stripe, sessionId: string) {
  const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100, expand: ["data.price.product"] });
  if (items.has_more) throw new Error(`Session ${sessionId} has more than 100 line items.`);
  return items.data.map((item) => {
    const product = item.price?.product;
    const meta = product && typeof product === "object" && !("deleted" in product && product.deleted) ? product.metadata : {};
    return {
      name: item.description,
      quantity: item.quantity,
      amount_total_cents: item.amount_total,
      merchant: meta.merchant ?? null,
      merchant_id: meta.merchant_id ?? null,
      product_id: meta.product_id ?? null,
      product_url: meta.product_url ?? null,
      piece_id: meta.piece_id ?? null,
      size: meta.size ?? null,
      size_defaulted_for_demo: meta.size_defaulted_for_demo === "true",
      variant_id: meta.variant_id ?? null,
      verified_at: meta.verified_at ?? null,
    };
  });
}

/**
 * Records a paid session once and asks Stripe to email the receipt once.
 * Any failure throws so the webhook answers 500 and Stripe retries; both steps are safe to repeat.
 */
export async function recordPaidOrder(session: Stripe.Checkout.Session): Promise<void> {
  const stripe = getStripe();
  await ensureSchema();
  const db = getDatabase();
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  const email = session.customer_details?.email ?? null;
  const shipping = session.collected_information?.shipping_details ?? null;

  const lines = await readLines(stripe, session.id);
  await db.execute({
    sql: `INSERT INTO orders (stripe_session_id, payment_intent_id, livemode, costume, amount_total_cents, currency,
        customer_email, shipping_json, lines_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(stripe_session_id) DO NOTHING`,
    args: [
      session.id, paymentIntent, session.livemode ? 1 : 0, session.metadata?.costume ?? null,
      session.amount_total ?? 0, session.currency ?? "usd", email,
      shipping ? JSON.stringify(shipping) : null, JSON.stringify(lines), new Date().toISOString(),
    ],
  });

  const saved = await db.execute({
    sql: "SELECT payment_intent_id, customer_email, receipt_requested_at FROM orders WHERE stripe_session_id = ?",
    args: [session.id],
  });
  const row = saved.rows[0];
  if (!row) throw new Error(`Order ${session.id} was not found after insert.`);
  if (row.receipt_requested_at || !row.payment_intent_id || !row.customer_email) return;

  await stripe.paymentIntents.update(String(row.payment_intent_id), { receipt_email: String(row.customer_email) });
  await db.execute({
    sql: "UPDATE orders SET receipt_requested_at = ? WHERE stripe_session_id = ? AND receipt_requested_at IS NULL",
    args: [new Date().toISOString(), session.id],
  });
}
