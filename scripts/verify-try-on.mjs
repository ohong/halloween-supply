// Run with: bun scripts/verify-try-on.mjs
// Runs the real route and image decoding, replacing only OpenAI's HTTP boundary.
// No photos, keys, or requests are sent to a provider.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import sharp from "sharp";

mock.module("server-only", () => ({}));
process.env.OPENAI_API_KEY = "test-only-not-a-key";
process.env.TRY_ON_TESTING_MODE = "0";
process.env.FALKORDB_URL = "";
const { POST } = await import("../app/api/try-on/route.ts");
const { costumes } = await import("../lib/costumes.ts");
const { getCostume } = await import("../lib/catalog.ts");
const view = await getCostume("cosmic-cowboy");
const image = await sharp({ create: { width: 400, height: 600, channels: 3, background: "#aaa" } }).jpeg().toBuffer();
const realFetch = globalThis.fetch;
let mode = "usable";
let calls = [];
let lastEdit;
globalThis.fetch = async (url, options) => {
  calls.push(String(url));
  assert(String(url).startsWith("https://api.openai.com/v1/"), "Unexpected external request");
  assert(String(url).endsWith("/images/edits"));
  assert(options.body instanceof FormData);
  lastEdit = options.body;
  if (mode === "unavailable") return new Response("", { status: 429 });
  if (mode === "malformed") return Response.json({ data: [] });
  assert.equal(options.body.get("model"), process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-flare");
  assert.equal(options.body.get("quality"), "low");
  assert.equal(options.body.get("size"), "672x1008");
  assert.equal(options.body.get("output_format"), "jpeg");
  assert(options.body.getAll("image[]").length >= 1);
  assert(options.body.get("prompt").includes("Preserve the same face"));
  assert(options.body.get("prompt").includes("Use the largest foreground person"));
  assert(options.body.get("prompt").includes("Remove every other person"));
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

mode = "malformed";
await expectStatus(request(), 502);
mode = "unavailable";
await expectStatus(request(), 429);
console.log("PASS image-provider errors without a photo-classifier dependency");

mode = "usable";
for (const costume of costumes) {
  calls = [];
  const response = await expectStatus(request({ slug: costume.slug }), 200);
  assert((await response.json()).image.startsWith("data:image/jpeg;base64,"));
  assert.equal(calls.length, 1);
}
console.log("PASS all costume previews go directly to image edits (provider responses simulated)");

const tiny = await sharp({ create: { width: 80, height: 120, channels: 3, background: "#aaa" } }).jpeg().toBuffer();
calls = [];
await expectStatus(request({ photo: new File([tiny], "small.jpg", { type: "image/jpeg" }) }), 200);
assert.equal(calls.length, 1);
console.log("PASS small readable photos are accepted without a minimum-resolution gate");

const selection = view.pieces.map(({ piece, options }) => ({ pieceId: piece.id, productId: options[0].product.id }));
await expectStatus(request({ selection }), 200);
assert.equal(lastEdit.getAll("image[]").length, 1 + view.pieces.filter(({ options }) => options[0].product.cutout?.startsWith("/products/")).length, "Raw merchant models must not be sent as garment references");
assert(lastEdit.getAll("image[]").every(image => image.type === "image/jpeg"));
await expectStatus(request({ selection: [{ ...selection[0], productId: "invented" }, ...selection.slice(1)] }), 400);
await expectStatus(request({ selection: selection.slice(1) }), 400);
await expectStatus(request({ selection, owned: [selection[0].pieceId] }), 400);
await expectStatus(request({ selection: selection.slice(1), skipped: [selection[0].pieceId] }), 400);
await expectStatus(request({ selection: selection.slice(1), owned: [selection[0].pieceId] }), 200);
await expectStatus(request({ owned: view.pieces.map(({ piece }) => piece.id) }), 200);
console.log("PASS selected products, owned pieces, duplicate protection, missing pieces and required-piece validation");

for (let i = 0; i < 5; i++) await expectStatus(request({ ip: "repeat-demo" }), 200);
process.env.TRY_ON_TESTING_MODE = "1";
for (let i = 0; i < 5; i++) await expectStatus(request({ ip: "repeat-demo" }), 200);
process.env.TRY_ON_TESTING_MODE = "0";
await expectStatus(request({ ip: "repeat-demo" }), 200);
delete process.env.OPENAI_API_KEY;
await expectStatus(request(), 503);
console.log("PASS repeated previews from one client and missing-key response");

// Optionally verify that the running storefront still exposes this feature.
// The route contract alone cannot catch components disconnected from the pages.
const storefront = process.argv.find((arg) => /^https?:\/\//.test(arg));
if (storefront) {
  globalThis.fetch = realFetch;
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    for (const costume of costumes) {
      const response = await page.goto(new URL(`/costumes/${costume.slug}`, storefront).href);
      assert.equal(response.status(), 200);
      await page.locator(".try-on").waitFor({ state: "attached" });
      const tab = page.getByRole("tab", { name: "Try it on", exact: true });
      if (await tab.count()) await tab.click();
      // Shared-look restoration intentionally hides controls until hydration.
      await page.locator(".try-on").waitFor({ state: "visible" });
      assert.equal(await page.locator('.try-on input[capture="environment"]').count(), 1);
      assert.equal(await page.getByRole("button", { name: "Take photo", exact: true }).count(), 1);
      assert.equal(await page.locator(".outfit-planner").count(), 0);
      if (costume.status === "live") {
        assert.equal(await page.getByRole("button", { name: "Shop for me", exact: true, includeHidden: true }).count(), 1);
        assert.equal(await page.locator(".carousel .slide").first().getAttribute("data-slide-key"), "complete-look");
        assert.equal(await page.locator('.carousel [data-slide-key="flat-lay"]').count(), 1);
      }
    }
  } finally { await browser.close(); }
  console.log("PASS hydrated storefront exposes photo upload and camera controls on all costume pages, with worn-look and pieces views on shoppable costumes");
}
