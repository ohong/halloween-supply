import { z } from "zod";
import { costumes } from "../costumes";

export const eventNames = [
  "view", "kit", "filter", "swap", "preview_request", "preview_completion", "preview_failure",
  "cart_add", "checkout_start", "checkout_recovery", "checkout_redirect", "source_timing", "provider_usage",
] as const;
export const eventSources = ["discovery", "look", "screenshot", "custom", "mirror", "cart", "checkout", "assistant"] as const;
export const eventStages = [
  "request", "complete", "failure", "cancel", "rejected", "parse", "state_applied", "provider_send", "first_frame",
  "catalog", "search", "reasoning", "image", "video", "render", "retry", "price_changed", "prices_accepted",
  "sold_out", "needs_sizes", "invalid_size", "unverified", "error", "redirect", "budget",
] as const;
export const eventProviders = ["openai", "anthropic", "fal", "decart", "decisions", "shopping", "merchant", "stripe"] as const;
export const eventModes = ["photo", "video", "text", "voice", "catalog", "screenshot", "custom", "demo", "live"] as const;

const knownSlugs = new Set([...costumes.map(({ slug }) => slug), "screenshot-look", "custom-look"]);

/** Saved look IDs identify user-created records, so collect only their category. */
export function telemetrySlug(slug: string | undefined): string | undefined {
  if (slug && /^custom-look:[0-9a-f-]{36}$/i.test(slug)) return "custom-look";
  return slug && knownSlugs.has(slug) ? slug : undefined;
}

export const eventPropertiesSchema = z.object({
  source: z.enum(eventSources).optional(),
  slug: z.string().refine((slug) => knownSlugs.has(slug)).optional(),
  durationMs: z.number().finite().min(0).max(600_000).optional(),
  stage: z.enum(eventStages).optional(),
  provider: z.enum(eventProviders).optional(),
  units: z.number().finite().min(0).max(100_000_000).optional(),
  mode: z.enum(eventModes).optional(),
}).strict();

export const eventSchema = z.object({
  version: z.literal(1),
  journeyId: z.string().regex(/^[0-9a-f]{32}$/),
  sequence: z.number().int().min(1).max(1_000),
  name: z.enum(eventNames),
  properties: eventPropertiesSchema,
}).strict();

export type EventName = typeof eventNames[number];
export type EventProperties = z.infer<typeof eventPropertiesSchema>;
export type TelemetryEvent = z.infer<typeof eventSchema>;
