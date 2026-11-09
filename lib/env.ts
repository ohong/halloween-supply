import { z } from "zod";

// Production environment contract. Required means a core feature fails without it; optional means the feature
// degrades or turns off (search falls back to local, clips stay off, signing falls back to another secret).
// Every name is read directly from process.env elsewhere; this file only checks presence at boot.
const present = z.string().trim().min(1);
const productionEnv = z.object({
  // Required
  TURSO_DATABASE_URL: present,
  TURSO_AUTH_TOKEN: present,
  STRIPE_SECRET_KEY: present,
  STRIPE_WEBHOOK_SECRET: present,
  OPENAI_API_KEY: present,
  ANTHROPIC_API_KEY: present,
  FAL_KEY: present,
  FIRECRAWL_API_KEY: present,
  CRON_SECRET: present,
  // Optional
  SAVED_LOOK_SIGNING_SECRET: present.optional(),
  TRY_ON_3D_SIGNING_SECRET: present.optional(),
  METERED_TURN_APP: present.optional(),
  METERED_TURN_API_KEY: present.optional(),
  GEMINI_API_KEY: present.optional(),
  VISION_SERVICE_URL: present.optional(),
  VISION_SERVICE_TOKEN: present.optional(),
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: present.optional(),
  NEXT_PUBLIC_POSTHOG_HOST: present.optional(),
});

/** Names of required production variables that are unset or blank. Never returns values. */
export function missingEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const result = productionEnv.safeParse(env);
  if (result.success) return [];
  return [...new Set(result.error.issues.map(issue => String(issue.path[0])))];
}

/** A live Stripe key with no webhook secret would take real money and never record the order. */
export function liveStripeWithoutWebhook(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY?.startsWith("sk_live")) && !env.STRIPE_WEBHOOK_SECRET?.trim();
}
