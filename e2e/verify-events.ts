/** Runtime integration check, no providers or checkout sessions.
 * Start local Next first. Then:
 * bun e2e/verify-events.ts http://localhost:3418 /path/to/next-stdout.log
 * Bundles the real client helper and sends actual browser requests to the real route.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

declare const Bun: {
  build(options: { entrypoints: string[]; target: "browser"; format: "esm"; minify: boolean }): Promise<{ success: boolean; outputs: { text(): Promise<string> }[] }>;
};

const origin = new URL(process.argv[2] ?? "http://localhost:3418").origin;
assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Run this check against localhost only.");
const build = await Bun.build({ entrypoints: [new URL("../lib/telemetry/client.ts", import.meta.url).pathname], target: "browser", format: "esm", minify: true });
assert(build.success, "The actual browser helper must bundle.");
const clientCode = await build.outputs[0].text();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const requests: { name: string; journeyId: string; sequence: number; properties: Record<string, unknown> }[] = [];
const statuses: number[] = [];
page.on("request", (request) => { if (request.url() === `${origin}/api/events`) requests.push(request.postDataJSON()); });
page.on("response", (response) => { if (response.url() === `${origin}/api/events`) statuses.push(response.status()); });

const install = async () => {
  await page.evaluate(async (code) => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    const helper = await import(/* webpackIgnore: true */ url);
    (window as unknown as { trackEvent: typeof helper.trackEvent }).trackEvent = helper.trackEvent;
    URL.revokeObjectURL(url);
  }, clientCode);
};

try {
  await page.goto(`${origin}/privacy`);
  await page.evaluate(() => sessionStorage.clear());
  await install();
  const sequence = ["view", "kit", "swap", "preview_request", "preview_completion", "cart_add", "checkout_start", "checkout_recovery", "checkout_redirect"];
  await page.evaluate((sequence) => {
    const track = (window as unknown as { trackEvent: (name: string, properties: object) => void }).trackEvent;
    sequence.forEach((name) => track(name, { source: "look", slug: "velvet-vampire", ...(name === "checkout_recovery" ? { stage: "price_changed" } : {}) }));
  }, sequence);
  await page.waitForFunction(() => (window.performance.getEntriesByType("resource").filter((entry) => entry.name.endsWith("/api/events"))).length >= 9);
  assert.deepEqual(requests.map(({ name }) => name), sequence);
  assert.equal(new Set(requests.map(({ journeyId }) => journeyId)).size, 1);
  assert.deepEqual(requests.map(({ sequence }) => sequence), sequence.map((_, index) => index + 1));
  assert.equal(statuses.length, sequence.length);
  assert(statuses.every((status) => status === 204), "The actual route must accept the browser journey.");
  const journeyId = requests[0].journeyId;
  await page.reload();
  await install();
  const reloadResponse = page.waitForResponse(`${origin}/api/events`);
  await page.evaluate(() => (window as unknown as { trackEvent: (name: string, properties: object) => void }).trackEvent("view", { source: "custom", slug: "custom-look:12345678-1234-1234-1234-123456789abc" }));
  assert.equal((await reloadResponse).status(), 204);
  assert.equal(requests.at(-1)?.journeyId, journeyId, "Reload retains this tab's anonymous journey.");
  assert.equal(requests.at(-1)?.sequence, 10);
  assert.equal(requests.at(-1)?.properties.slug, "custom-look", "Saved look IDs must never be sent.");
  const timingResponse = page.waitForResponse(`${origin}/api/events`);
  await page.evaluate(() => (window as unknown as { trackEvent: (name: string, properties: object) => void }).trackEvent("source_timing", {
    source: "look", mode: "photo", stage: "image", provider: "openai", durationMs: 125,
  }));
  assert.equal((await timingResponse).status(), 204);
  const usageResponse = page.waitForResponse(`${origin}/api/events`);
  await page.evaluate(() => (window as unknown as { trackEvent: (name: string, properties: object) => void }).trackEvent("provider_usage", {
    source: "look", mode: "photo", stage: "image", provider: "openai", units: 1,
  }));
  assert.equal((await usageResponse).status(), 204);

  for (const property of ["doNotTrack", "globalPrivacyControl"]) {
    await page.evaluate((property) => Object.defineProperty(navigator, property, { configurable: true, get: () => property === "doNotTrack" ? "1" : true }), property);
    const count = requests.length;
    await page.evaluate(() => (window as unknown as { trackEvent: (name: string) => void }).trackEvent("view"));
    await page.waitForTimeout(100);
    assert.equal(requests.length, count, `${property} suppresses the client request.`);
    await page.evaluate((property) => Object.defineProperty(navigator, property, { configurable: true, get: () => property === "doNotTrack" ? "0" : false }), property);
  }

  const event = { version: 1, journeyId: crypto.randomUUID().replaceAll("-", ""), sequence: 1, name: "view", properties: { source: "discovery" } };
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${origin}/api/events`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
  });
  assert.equal((await post(event, { Origin: "https://unrelated.example" })).status, 403);
  assert.equal((await post(event, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await post(event, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await post("bad json")).status, 400);
  assert.equal((await post({ ...event, photo: "private-fixture" })).status, 400);
  assert.equal((await post({ ...event, properties: { source: "discovery", query: "private-fixture" } })).status, 400);
  assert.equal((await post({ ...event, properties: { slug: "private-fixture" } })).status, 400);
  assert.equal((await post({ ...event, properties: { durationMs: 600_001 } })).status, 400);
  assert.equal((await post(" ".repeat(2_049))).status, 413);
  const streamed = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(" ".repeat(2_049))); controller.close(); } });
  assert.equal((await fetch(`${origin}/api/events`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: streamed, duplex: "half" } as RequestInit)).status, 413);
  assert.equal((await post(event, { DNT: "1" })).status, 204);
  assert.equal((await post(event, { "Sec-GPC": "1" })).status, 204);
  const accepted = await Promise.all(Array.from({ length: 60 }, (_, index) => post({ ...event, sequence: index + 1 })));
  assert(accepted.every((response) => response.status === 204));
  assert.equal((await post(event)).status, 204, "A duplicate is accepted without another log.");
  assert.equal((await post({ ...event, sequence: 61 })).status, 429);

  if (process.argv[3]) {
    const lines = readFileSync(process.argv[3], "utf8").split(/\r?\n/).filter((line) => line.startsWith("[telemetry] "));
    const logged = lines.map((line) => JSON.parse(line.slice("[telemetry] ".length)) as { journeyId: string; sequence: number; name: string });
    assert.deepEqual(logged.filter((item) => item.journeyId === journeyId).sort((a, b) => a.sequence - b.sequence).map(({ name }) => name), [...sequence, "view", "source_timing", "provider_usage"]);
    assert.equal(logged.filter((item) => item.journeyId === event.journeyId).length, 60, "Private signals, invalid requests and duplicates must not add logs.");
    assert(!lines.some((line) => line.includes("private-fixture")), "Rejected private fields must never reach event logs.");
    console.log("PASS server stdout contains the exact journey, no rejected content, and no duplicate or private-signal logs.");
  }
  console.log("PASS actual browser helper -> Next route: ordered journey, reload continuity, custom ID removal, DNT/GPC suppression.");
  console.log("PASS endpoint: origin, content type, schema, duration, declared/streamed size bounds, deduplication and journey rate limit.");
} finally { await browser.close(); }
