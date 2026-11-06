import { parseTelemetryEvent, type TelemetryEvent } from "./schema";

export const MAX_EVENT_BYTES = 2_048;
const WINDOW_MS = 60_000;
const MAX_JOURNEY_EVENTS = 60;
const MAX_WINDOW_EVENTS = 5_000;
const journeys = new Map<string, { count: number; sequences: Set<number> }>();
let windowStarted = Date.now();
let windowEvents = 0;

export function parseEvent(value: unknown): TelemetryEvent | null {
  return parseTelemetryEvent(value);
}

/** A process-local bound, not a durable rate limiter across hosting instances. */
export function recordEvent(event: TelemetryEvent): "accepted" | "duplicate" | "limited" {
  const now = Date.now();
  if (now - windowStarted >= WINDOW_MS) {
    journeys.clear();
    windowEvents = 0;
    windowStarted = now;
  }
  const journey = journeys.get(event.journeyId) ?? { count: 0, sequences: new Set<number>() };
  if (journey.sequences.has(event.sequence)) return "duplicate";
  if (windowEvents >= MAX_WINDOW_EVENTS || journey.count >= MAX_JOURNEY_EVENTS) return "limited";
  journey.count++;
  journey.sequences.add(event.sequence);
  journeys.set(event.journeyId, journey);
  windowEvents++;
  // Never add request headers, URLs, errors, user content, or device metadata here.
  console.info(`[telemetry] ${JSON.stringify({ ...event, receivedAt: new Date(now).toISOString() })}`);
  return "accepted";
}
