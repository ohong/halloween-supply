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

export type EventName = typeof eventNames[number];
export interface EventProperties {
  source?: typeof eventSources[number];
  slug?: string;
  durationMs?: number;
  stage?: typeof eventStages[number];
  provider?: typeof eventProviders[number];
  units?: number;
  mode?: typeof eventModes[number];
}
export interface TelemetryEvent {
  version: 1;
  journeyId: string;
  sequence: number;
  name: EventName;
  properties: EventProperties;
}

const eventKeys = new Set(["version", "journeyId", "sequence", "name", "properties"]);
const propertyKeys = new Set(["source", "slug", "durationMs", "stage", "provider", "units", "mode"]);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const member = (value: unknown, choices: readonly string[]) => typeof value === "string" && choices.includes(value);
const optionalMember = (value: unknown, choices: readonly string[]) => value === undefined || member(value, choices);
const bounded = (value: unknown, max: number) => value === undefined || typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;

/** Shared, dependency-free validation keeps the browser helper small. Unknown keys fail closed. */
export function parseTelemetryEvent(value: unknown): TelemetryEvent | null {
  if (!object(value) || Object.keys(value).some((key) => !eventKeys.has(key))) return null;
  if (value.version !== 1 || typeof value.journeyId !== "string" || !/^[0-9a-f]{32}$/.test(value.journeyId) ||
    typeof value.sequence !== "number" || !Number.isInteger(value.sequence) || value.sequence < 1 || value.sequence > 1_000 ||
    !member(value.name, eventNames)) return null;
  const properties = value.properties;
  if (!object(properties) || Object.keys(properties).some((key) => !propertyKeys.has(key))) return null;
  if (!optionalMember(properties.source, eventSources) || !optionalMember(properties.stage, eventStages) ||
    !optionalMember(properties.provider, eventProviders) || !optionalMember(properties.mode, eventModes) ||
    !bounded(properties.durationMs, 600_000) || !bounded(properties.units, 100_000_000) ||
    properties.slug !== undefined && (typeof properties.slug !== "string" || !knownSlugs.has(properties.slug))) return null;
  return value as unknown as TelemetryEvent;
}
