import { getStripe } from "@/lib/checkout/stripe";
import { recordPaidOrder } from "@/lib/orders/store";
import { captureError } from "@/lib/errors";

const json = (body: Record<string, unknown>, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Stripe calls this after payment. A non-2xx answer makes Stripe retry, so failures must surface. */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set");
    return json({ error: "webhook_not_configured" }, 500);
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return json({ error: "missing_signature" }, 400);

  const payload = await request.text();
  let event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch {
    return json({ error: "invalid_signature" }, 400);
  }

  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return json({ received: true }, 200);
  }
  const session = event.data.object;
  if (session.payment_status !== "paid") return json({ received: true }, 200);

  try {
    await recordPaidOrder(session);
  } catch (error) {
    console.error("[stripe-webhook] order recording failed", event.id, session.id, error instanceof Error ? error.message : "UnknownError");
    await captureError(error, { source: "stripe-webhook", eventId: event.id, sessionId: session.id });
    return json({ error: "order_recording_failed" }, 500);
  }
  return json({ received: true }, 200);
}
