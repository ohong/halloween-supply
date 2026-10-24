import Stripe from "stripe";

let client: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Cached Stripe client from STRIPE_SECRET_KEY. Throws when the key is unset. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  client ??= new Stripe(key, { maxNetworkRetries: 1, timeout: 20_000 });
  return client;
}

export function createCheckoutSession(params: Stripe.Checkout.SessionCreateParams) {
  return getStripe().checkout.sessions.create(params);
}
