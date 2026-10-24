import "server-only";

import Stripe from "stripe";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY. Set it in .env.local.");
  client ??= new Stripe(key);
  return client;
}
