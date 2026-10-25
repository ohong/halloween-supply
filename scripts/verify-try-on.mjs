// Run with: bun scripts/verify-try-on.mjs
// Runs the real route and image decoding, replacing only OpenAI's HTTP boundary.
// No photos, keys, or requests are sent to a provider.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import sharp from "sharp";

mock.module("server-only", () => ({}));
process.env.OPENAI_API_KEY = "test-only-not-a-key";
process.env.FALKORDB_URL = "";
const { POST } = await import("../app/api/try-on/route.ts");
const { costumes } = await import("../lib/costumes.ts");
const { getCostume } = await import("../lib/catalog.ts");
const view = await getCostume("cosmic-cowboy");
const image = await sharp({ create: { width: 400, height: 600, channels: 3, background: "#aaa" } }).jpeg().toBuffer();
const realFetch = globalThis.fetch;
let mode = "usable";
let calls = [];
globalThis.fetch = async (url, options) => {
  calls.push(String(url));
  assert(String(url).startsWith("https://api.openai.com/v1/"), "Unexpected external request");
  if (String(url).endsWith("/decisions")) {
    const body = JSON.parse(options.body);
    assert.equal(body.model, process.env.OPENAI_DECISION_MODEL || "gpt-6-luna");
    assert.equal(body.questions[0].name, "photo_suitability");
    assert(body.input[0].content[1].image_url.startsWith("data:image/jpeg;base64,"));
    if (mode === "unavailable") return new Response("", { status: 429 });
    if (mode === "malformed") return Response.json({ answers: [] });
    return Response.json({ answers: [mode === "refusal" ? { name: "photo_suitability", type: "refusal" } : { name: "photo_suitability", type: "choice", choice: mode }] });
  }
  assert(String(url).endsWith("/images/edits"));
  assert(options.body instanceof FormData);
  assert.equal(options.body.get("model"), process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst");
  assert.equal(options.body.get("output_format"), "jpeg");
  assert(options.body.getAll("image[]").length >= 1);
  assert(options.body.get("prompt").includes("Preserve the same face"));
  return Response.json({ data: [{ b64_json: image.toString("base64") }] });
};
let sequence = 0;
function request({ slug = "cosmic-cowboy", consent = "true", photo = new File([image], "photo.jpg", { type: "image/jpeg" }), selection = [], owned = [], skipped = [], origin = "http://localhost", ip } = {}) {
  const body = new FormData();
  body.set("costumeSlug", slug); body.set("consent", consent); body.set("photo", photo);
  body.set("selection", JSON.stringify(selection)); body.set("ownedPieceIds", JSON.stringify(owned)); body.set("skippedPieceIds", JSON.stringify(skipped));
  return new Request("http://localhost/api/try-on", { method: "POST", body, headers: { origin, "x-real-ip": ip ?? `test-${sequence++}` } });
}
async function expectStatus(input, status) {
  const response = await POST(input);
  assert.equal(response.status, status, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return response;
}
await expectStatus(request({ origin: "https://unrelated.example" }), 403);
await expectStatus(request({ consent: "false" }), 400);
await expectStatus(request({ slug: "unknown" }), 400);
await expectStatus(request({ photo: new File(["not a photo"], "fake.jpg", { type: "image/jpeg" }) }), 400);
await expectStatus(request({ photo: new File([image], "fake.svg", { type: "image/svg+xml" }) }), 400);
await expectStatus(new Request("http://localhost/api/try-on", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "5000000" }, body: "x" }), 413);
assert.equal(calls.length, 0, "Invalid inputs must never reach OpenAI");
console.log("PASS origin, consent, file decoding, file type, body size and costume validation");

for (const rejected of ["cropped", "multiple", "unsuitable", "refusal", "malformed"]) {
  mode = rejected; calls = [];
  await expectStatus(request(), 422);
  assert.equal(calls.length, 1, "Rejected photos must not reach the image model");
}
mode = "unavailable";
await expectStatus(request(), 429);
console.log("PASS unsuitable-photo and refusal handling; no image call after rejection; upstream rate limit");

mode = "usable";
for (const costume of costumes) {
  calls = [];
  const response = await expectStatus(request({ slug: costume.slug }), 200);
  assert((await response.json()).image.startsWith("data:image/jpeg;base64,"));
  assert.equal(calls.length, 2);
}
console.log("PASS all costume references through Decisions → image edits (provider responses simulated)");

const selection = view.pieces.map(({ piece, options }) => ({ pieceId: piece.id, productId: options[0].product.id }));
await expectStatus(request({ selection }), 200);
await expectStatus(request({ selection: [{ ...selection[0], productId: "invented" }, ...selection.slice(1)] }), 400);
await expectStatus(request({ selection: selection.slice(1) }), 400);
await expectStatus(request({ selection, owned: [selection[0].pieceId] }), 400);
await expectStatus(request({ selection: selection.slice(1), skipped: [selection[0].pieceId] }), 400);
await expectStatus(request({ selection: selection.slice(1), owned: [selection[0].pieceId] }), 200);
await expectStatus(request({ owned: view.pieces.map(({ piece }) => piece.id) }), 200);
console.log("PASS selected products, owned pieces, duplicate protection, missing pieces and required-piece validation");

for (let i = 0; i < 3; i++) await expectStatus(request({ ip: "quota-test" }), 200);
await expectStatus(request({ ip: "quota-test" }), 429);
delete process.env.OPENAI_API_KEY;
await expectStatus(request(), 503);
console.log("PASS per-client quota and missing-key response");

// Optionally verify that the running storefront still exposes this feature.
// The route contract alone cannot catch components disconnected from the pages.
const storefront = process.argv.find((arg) => /^https?:\/\//.test(arg));
if (storefront) {
  globalThis.fetch = realFetch;
  await Promise.all(costumes.map(async (costume) => {
    const response = await realFetch(new URL(`/costumes/${costume.slug}`, storefront), { signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert(html.includes('class="try-on"'), `${costume.slug} is missing the try-on form`);
    assert(html.includes('capture="environment"'), `${costume.slug} is missing mobile camera capture`);
    assert(html.includes("Take photo"), `${costume.slug} is missing the camera button`);
    if (costume.status === "live") assert(html.includes("Shop for me"), `${costume.slug} is missing Shop for me`);
    assert(!html.includes("outfit-planner"), "Removed planner is still rendered");
    assert(!html.includes("Compare outfits"), "Removed comparisons are still rendered");
    assert(!html.includes("I own this"), "Removed wardrobe controls are still rendered");
    assert(!html.includes("Why this pick"), "Removed reasons are still rendered");
    const carousel = html.slice(html.indexOf('aria-label="Costume images"'));
    if (costume.status === "live") assert(decodeURIComponent(carousel.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? "").includes(costume.image), "Full costume must be first");
  }));
  console.log("PASS running storefront exposes try-on on all costume pages and Shop for me on shoppable costumes, without the removed planner or wardrobe controls");
}
