/** Aggregate exported hosting logs. Run: bun scripts/summarize-events.ts /path/to/events.log
 * Pipe raw JSONL or lines containing `[telemetry] {json}` with `-` as the path.
 * Output contains aggregates only; no individual journey IDs.
 */
import { readFileSync } from "node:fs";
import { parseTelemetryEvent, type TelemetryEvent } from "../lib/telemetry/schema";

type RecordEvent = TelemetryEvent & { receivedAt: string };
const input = process.argv[2];
if (!input || input === "--help") {
  console.log("Usage: bun scripts/summarize-events.ts <exported-log-file|-> [--since=ISO-date]");
  process.exit(input ? 0 : 1);
}
const sinceArgument = process.argv.find((arg) => arg.startsWith("--since="))?.slice(8);
const since = sinceArgument ? Date.parse(sinceArgument) : -Infinity;
if (Number.isNaN(since)) throw new Error("--since must be an ISO date.");
const lines = readFileSync(input === "-" ? 0 : input, "utf8").split(/\r?\n/);
const events: RecordEvent[] = [];
const seen = new Set<string>();
let ignoredLines = 0;
let duplicateEvents = 0;

function parseLine(line: string): RecordEvent | undefined {
  try {
    let value: unknown;
    if (line.trimStart().startsWith("{")) {
      value = JSON.parse(line);
      if (value && typeof value === "object" && "message" in value && typeof value.message === "string") {
        return parseLine(value.message);
      }
    } else {
      const marker = line.indexOf("[telemetry] ");
      if (marker < 0) return;
      value = JSON.parse(line.slice(marker + "[telemetry] ".length));
    }
    if (!value || typeof value !== "object" || !("receivedAt" in value) || typeof value.receivedAt !== "string") return;
    const { receivedAt, ...event } = value;
    if (!Number.isFinite(Date.parse(receivedAt))) return;
    const parsed = parseTelemetryEvent(event);
    if (parsed) return { ...parsed, receivedAt };
  } catch { /* Mixed hosting exports can contain other logs; do not echo their content. */ }
}

for (const line of lines) {
  if (!line.trim()) continue;
  const event = parseLine(line);
  if (!event) { ignoredLines++; continue; }
  if (Date.parse(event.receivedAt) < since) continue;
  const key = `${event.journeyId}:${event.sequence}`;
  if (seen.has(key)) { duplicateEvents++; continue; }
  seen.add(key);
  events.push(event);
}

const journeys = new Map<string, RecordEvent[]>();
const eventCounts: Record<string, number> = {};
const recoveryCounts: Record<string, number> = {};
const latencies = new Map<string, number[]>();
const usage = new Map<string, { events: number; units: number }>();
for (const event of events) {
  const journey = journeys.get(event.journeyId) ?? [];
  journey.push(event);
  journeys.set(event.journeyId, journey);
  eventCounts[event.name] = (eventCounts[event.name] ?? 0) + 1;
  const { source = "unspecified", stage = "unspecified", provider = "unspecified", mode = "unspecified", durationMs, units } = event.properties;
  const group = `${event.name}/${source}/${stage}/${provider}/${mode}`;
  if (event.name === "checkout_recovery") recoveryCounts[stage] = (recoveryCounts[stage] ?? 0) + 1;
  if (durationMs !== undefined) {
    const samples = latencies.get(group) ?? [];
    samples.push(durationMs);
    latencies.set(group, samples);
  }
  if (event.name === "provider_usage" && units !== undefined) {
    const value = usage.get(group) ?? { events: 0, units: 0 };
    value.events++;
    value.units += units;
    usage.set(group, value);
  }
}

function funnel(steps: TelemetryEvent["name"][]) {
  const counts = steps.map(() => 0);
  for (const events of journeys.values()) {
    let next = 0;
    for (const event of events.sort((a, b) => a.sequence - b.sequence)) {
      if (event.name === steps[next]) { counts[next]++; next++; }
      if (next === steps.length) break;
    }
  }
  return steps.map((step, index) => ({
    step, journeys: counts[index],
    percentOfFirst: counts[0] ? Math.round(counts[index] / counts[0] * 10_000) / 100 : null,
  }));
}

function percentile(samples: number[], percentile: number) {
  return Math.round(samples[Math.max(0, Math.ceil(samples.length * percentile) - 1)] * 100) / 100;
}

console.log(JSON.stringify({
  source: "anonymous_browser_events_not_billing", observedJourneys: journeys.size, observedEvents: events.length,
  ignoredLines, duplicateEvents,
  range: events.length ? {
    first: events.reduce((first, event) => event.receivedAt < first ? event.receivedAt : first, events[0].receivedAt),
    last: events.reduce((last, event) => event.receivedAt > last ? event.receivedAt : last, events[0].receivedAt),
  } : null,
  eventCounts, checkoutRecovery: recoveryCounts,
  discoveryToCheckout: funnel(["view", "kit", "cart_add", "checkout_start", "checkout_redirect"]),
  previewToCart: funnel(["preview_request", "preview_completion", "cart_add"]),
  latencyMs: Array.from(latencies, ([group, samples]) => {
    samples.sort((a, b) => a - b);
    return { group, samples: samples.length, p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), max: samples.at(-1) };
  }),
  measuredUsageUnits: Array.from(usage, ([group, value]) => ({ group, ...value })),
  limits: [
    "Browser events are best effort, user-controllable, and can be blocked or dropped.",
    "A journey is one tab/session, not a unique person. Opening a new tab may copy initial session storage.",
    "Ordered funnels count only observed steps; preview and swap are optional shopping paths.",
    "Provider units require caller-defined measured units; do not mix unit types within a group.",
    "No provider billing, exact cost, purchase completion, or server-side provider latency is inferred.",
  ],
}, null, 2));
