/** Real route streams, real receipt helper and actual image decoding.
 * Only paid vision and product sourcing boundaries use fixtures.
 * bun scripts/verify-sourced-event-availability.mjs
 * Add --clip in the integrated checkout to verify the optional clip route too.
 * No database, provider, merchant or checkout request occurs.
 */
import assert from "node:assert/strict";
import { mock } from "bun:test";
import sharp from "sharp";

mock.module("server-only", () => ({}));
const keys = ["NODE_ENV", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "SAVED_LOOK_SIGNING_SECRET", "OPENAI_API_KEY", "FIRECRAWL_API_KEY"];
const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
process.env.NODE_ENV = "production";
delete process.env.TURSO_DATABASE_URL; delete process.env.TURSO_AUTH_TOKEN; delete process.env.SAVED_LOOK_SIGNING_SECRET;
process.env.OPENAI_API_KEY = "fixture-only-no-provider-call";
process.env.FIRECRAWL_API_KEY = "fixture-only-no-provider-call";
let mode = "luna";
const pieces = [
  { name: "Silver western boots", slot: "feet", query: "silver western boots", alternate: "silver cowboy boots", assembly: null, sizeKind: "shoe" },
  { name: "Black western hat", slot: "head", query: "black western hat", alternate: "black cowboy hat", assembly: null, sizeKind: "hat" },
];
const look = { character: "Silver and black western outfit", summary: "Fixture outfit.", pieces };
const seen = pieces.map((piece, id) => ({ id, slot: piece.slot, region: {}, crop_b64: "", colors: [], garment_types: [], area_frac: 0.5, pattern: "solid", query: piece.query, alternate: piece.alternate, outline: [] }));
mock.module("../lib/sourcing/screenshot-vision", () => ({ SCREENSHOT_VISION_MODEL: "fixture-analysis", decomposeScreenshot: async () => look, labelSegments: async () => ({ pieces: [] }) }));
mock.module("../lib/sourcing/vision-client", () => ({
  visionMode: () => mode, visionModel: async () => "fixture-opencv", analyze: async () => ({ person: { found: true, confidence: 1 }, timings_ms: {}, pieces: seen }), applyLabels: () => ({ seen, look }),
}));
mock.module("../lib/sourcing/screenshot", () => ({ screenshotSourcing: () => async (piece, onMatch, onReady, hooks) => {
  const index = pieces.findIndex(row => row.name === piece.name);
  const hit = { title: piece.name, url: `https://independent-shop.com/products/fixture-${index}`, image: `https://cdn.independent-shop.com/fixture-${index}.jpg`, priceCents: 2500, merchant: "Verification only", sizes: ["8", "9"], why: "Fixture match." };
  onMatch({ title: hit.title, url: hit.url, merchant: hit.merchant, image: hit.image, priceCents: hit.priceCents, currency: "USD", availability: "in_stock", kind: "product", note: "Fixture candidate." });
  if (mode === "opencv" && index === 1 && hooks) hooks.onApproval(hit, "weak_score"); else onReady(hit);
} }));
const { POST: screenshot } = await import("../app/api/screenshot-costume/route");
const { POST: save } = await import("../app/api/saved-looks/route");
const { signSourcedItem, verifySourcedItem, isSourcedItemSigningAvailable } = await import("../lib/custom-looks/item-proof");
const photo = await sharp({ create: { width: 80, height: 120, channels: 3, background: "white" } }).jpeg().toBuffer();
const origin = "http://localhost:3342";
let checks = 0;
async function inspect(response, expectedKinds) {
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  assert(!events.some(event => event.t === "error"));
  assert.equal(events.filter(event => event.t === "candidate").length, 2);
  const products = events.filter(event => ["piece", "approval"].includes(event.t));
  assert.deepEqual(products.map(event => event.t).sort(), expectedKinds.sort());
  assert(products.every(event => event.item?.productId && !Object.hasOwn(event, "proof")), "Production without a signing secret must still emit actual product events, without fabricated receipts.");
  assert(events.some(event => event.t === "done"));
  checks++;
  return products;
}
try {
  assert.equal(isSourcedItemSigningAvailable(), false);
  const screenshotForm = () => { const form = new FormData(); form.set("photo", new File([photo], "fixture.jpg", { type: "image/jpeg" })); return form; };
  let products;
  for (const providerMode of ["luna", "opencv"]) {
    mode = providerMode;
    products = await inspect(await screenshot(new Request(`${origin}/api/screenshot-costume`, { method: "POST", headers: { origin }, body: screenshotForm() })), providerMode === "opencv" ? ["piece", "approval"] : ["piece", "piece"]);
  }
  assert.equal(signSourcedItem(products[0].item), undefined);
  assert.equal(verifySourcedItem(products[0].item, "a".repeat(64)), false);
  const unavailable = await save(new Request(`${origin}/api/saved-looks`, { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify({ requestId: crypto.randomUUID(), name: look.character, summary: look.summary, model: "male", pieces: [{ piece: pieces[0], item: products[0].item }] }) }));
  assert.equal(unavailable.status, 503);
  assert.match((await unavailable.json()).error, /Saving this look is unavailable.*found pieces remain/); checks++;
  process.env.SAVED_LOOK_SIGNING_SECRET = "fixture-only-stable-receipt-key";
  const signed = signSourcedItem(products[0].item);
  assert.match(signed, /^[a-f0-9]{64}$/); assert(verifySourcedItem(products[0].item, signed)); checks++;
  delete process.env.SAVED_LOOK_SIGNING_SECRET;
  if (process.argv.includes("--clip")) {
    mock.module("../lib/sourcing/clip-vision", () => ({ analyzeClip: async () => ({ look, bestFrameSeconds: 1 }), clipEnabled: () => true, clipModel: () => "fixture-clip", parseYouTubeId: () => "9hE5-98ZeCg" }));
    const { POST: clip } = await import("../app/api/clip-costume/route");
    mode = "luna";
    const form = new FormData(); form.set("youtube", "https://youtu.be/9hE5-98ZeCg");
    await inspect(await clip(new Request(`${origin}/api/clip-costume`, { method: "POST", headers: { origin }, body: form })), ["piece", "piece"]);
  }
  console.log(`PASS ${checks} availability checks: actual screenshot${process.argv.includes("--clip") ? ", clip" : ""} streams preserve candidates/products without production signing; saved route returns clear 503; stable signing still verifies. Paid boundaries use fixtures; no external calls.`);
} finally {
  for (const key of keys) { const value = before[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
