// bun scripts/verify-try-on-3d.mjs
// Real route handlers and signed preview permissions; only provider HTTP is simulated.
import assert from "node:assert/strict";
import { mock } from "bun:test";
mock.module("server-only", () => ({}));
process.env.FAL_KEY = "test-only-fal";

process.env.TRY_ON_3D_SIGNING_SECRET = "test-only-signing-secret";
const { offer3d, configuredProvider } = await import("../lib/try-on-3d/server.ts");
const { POST: create } = await import("../app/api/try-on/3d/route.ts");
const { POST: status } = await import("../app/api/try-on/3d/status/route.ts");
let calls = [], providerState = "queued", providerFailure = 0, sequence = 0;
const image = "data:image/jpeg;base64,dGVzdA==";
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  calls.push({ url: String(url), options });
  if (providerFailure) return new Response("Private provider details must not escape", { status: providerFailure });
  assert(String(url).startsWith("https://queue.fal.run/"));
  assert.equal(options.headers.Authorization, "Key test-only-fal");
  if (options.method === "POST") {
    const input = JSON.parse(options.body);
    if (String(url).includes("meshy/v7.1")) {
      assert.equal(input.image_url, image);
      assert.equal(input.model_type, "standard");
      assert.equal(input.target_polycount, 40000);
      assert.equal(input.should_texture, true);
      assert.equal(input.enable_safety_checker, true);
    } else {
      assert.equal(input.face_count, 40000);
      assert.equal(input.generate_type, "Normal");
      assert.equal(input.input_image_url, image);
    }
    return Response.json({ request_id: `fal-${sequence++}` });
  }
  if (String(url).endsWith("/status")) return Response.json({ status: { queued: "IN_QUEUE", processing: "IN_PROGRESS", ready: "COMPLETED", failed: "COMPLETED" }[providerState] });
  return Response.json(providerState === "failed" ? { error: "private details" } : { model_glb: { url: "https://v3.fal.media/test.glb" } });
};
function request(body, origin = "http://localhost") { return new Request("http://localhost/api/try-on/3d", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
async function expect(handler, body, code, origin) {
  const response = await handler(request(body, origin));
  assert.equal(response.status, code, await response.clone().text());
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  return response.json();
}
try {
  process.env.TRY_ON_3D_PROVIDER = "";
  assert.equal(configuredProvider(), "meshy");
  delete process.env.FAL_KEY;
  assert.equal(configuredProvider(), null);
  process.env.FAL_KEY = "test-only-fal";
  const offer = offer3d(image);
  const body = { image, ticket: offer.ticket, consent: true };
  await expect(create, body, 403, "https://unrelated.example");
  await expect(create, { ...body, consent: false }, 400);
  await expect(create, { ...body, image: image + "changed" }, 403);
  await expect(create, { ...body, ticket: body.ticket + "invalid" }, 403);
  await expect(status, { token: body.ticket }, 403);
  const huge = new Request("http://localhost/api/try-on/3d", { method: "POST", body: "x".repeat(6_100_001), headers: { "Content-Type": "application/json" } });
  assert.equal((await create(huge)).status, 413);
  assert.equal(calls.length, 0, "Invalid requests must not create provider costs");
  console.log("PASS consent, origin, image binding, token tampering, token purpose, streamed body limit and provider selection");
  for (const provider of ["meshy", "hunyuan"]) {
    process.env.TRY_ON_3D_PROVIDER = provider;
    const offer = offer3d(image), body = { image, ticket: offer.ticket, consent: true };
    const before = calls.length;
    const [first, repeated] = await Promise.all([expect(create, body, 202), expect(create, body, 202)]);
    assert.equal(first.token, repeated.token);
    assert.equal(calls.length, before + 1, "Repeated clicks must share the provider job");
    for (const state of ["queued", "processing", "ready", "failed"]) {
      providerState = state;
      const result = await expect(status, { token: first.token }, 200);
      assert.equal(result.status, state);
      if (state === "ready") assert(result.modelUrl.startsWith("https://"));
      assert(!JSON.stringify(result).includes("private details"));
    }
    providerFailure = 429;
    await expect(status, { token: first.token }, 429);
    providerFailure = 503;
    await expect(status, { token: first.token }, 502);
    providerFailure = 0;
    const originalNow = Date.now;
    Date.now = () => originalNow() + 25 * 60 * 60_000;
    await expect(status, { token: first.token }, 410);
    Date.now = originalNow;
    console.log(`PASS ${provider} request settings, concurrent deduplication, queue → processing → GLB, failure, reconnect errors and expiry`);
  }
} finally { globalThis.fetch = realFetch; }
