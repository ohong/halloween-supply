/** Paid, synthetic-only benchmark: BENCHMARK_IMAGE_EDITS=1 bun --env-file=.env.local scripts/benchmark-try-on.mjs <output-directory>
 * Captures the real route's prepared edit, then compares real provider requests.
 * Only the capture response is simulated; every timed generation is real.
 */
import assert from "node:assert/strict";
import { mock } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

assert.equal(process.env.BENCHMARK_IMAGE_EDITS, "1", "Explicitly opt in to paid image generation.");
assert(process.env.OPENAI_API_KEY, "Configure the project API key.");
const output = path.resolve(process.argv[2] ?? "/tmp/try-on-benchmark");
await mkdir(output, { recursive: true });
mock.module("server-only", () => ({}));
const { POST } = await import("../app/api/try-on/route");
const { getCostume } = await import("../lib/catalog");
const view = await getCostume("pumpkin-harlequin");
assert(view);
const person = await sharp("public/costumes/models/cosmic-cowboy-male.webp").flatten({ background: "white" }).jpeg({ quality: 90 }).toBuffer();
const form = new FormData();
form.set("consent", "true");
form.set("costumeSlug", view.costume.slug);
form.set("selection", JSON.stringify(view.pieces.map(({ piece, options }) => ({ pieceId: piece.id, productId: options.find(({ product }) => product.availability !== "out_of_stock").product.id }))));
form.set("photo", new File([person], "synthetic-model.jpg", { type: "image/jpeg" }));
let prepared;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url, init) => {
  if (String(url) !== "https://api.openai.com/v1/images/edits") return realFetch(url, init);
  assert(init?.body instanceof FormData);
  prepared = init.body;
  return Response.json({ data: [{ b64_json: person.toString("base64") }] });
});
const prepareStarted = performance.now();
try {
  const response = await POST(new Request("http://localhost/api/try-on", { method: "POST", body: form, headers: { origin: "http://localhost" } }));
  assert.equal(response.status, 200, await response.clone().text());
} finally { globalThis.fetch = realFetch; }
const prepareMs = performance.now() - prepareStarted;
assert(prepared);
const entries = [...prepared.entries()];
const inputBytes = entries.reduce((total, [, value]) => total + (typeof value === "string" ? Buffer.byteLength(value) : value.size), 0);
const promptHash = createHash("sha256").update(String(prepared.get("prompt"))).digest("hex");
const cases = process.argv.includes("--optimized-only")
  ? [{ name: "optimized", model: "gpt-image-2.5-flare", quality: "low", size: "672x1008" }]
  : [
    { name: "sunburst-medium", model: "gpt-image-2.5-sunburst", quality: "medium", size: "1024x1536" },
    { name: "flare-medium", model: "gpt-image-2.5-flare", quality: "medium", size: "1024x1536" },
    { name: "flare-fast", model: "gpt-image-2.5-flare", quality: "low", size: "672x1008" },
  ];
const results = [];
for (let round = 0; round < 2; round++) {
  for (const settings of round % 2 ? [...cases].reverse() : cases) {
    const edit = new FormData();
    for (const [key, value] of entries) edit.append(key, value);
    edit.set("model", settings.model); edit.set("quality", settings.quality); edit.set("size", settings.size);
    const start = performance.now();
    const response = await realFetch("https://api.openai.com/v1/images/edits", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: edit,
      signal: AbortSignal.timeout(180_000),
    });
    const data = await response.json();
    const milliseconds = Math.round(performance.now() - start);
    assert.equal(response.status, 200, `Provider status ${response.status}`);
    assert(data.data?.[0]?.b64_json, "Provider returned no image");
    const filename = `${settings.name}-${round + 1}.jpg`;
    await writeFile(path.join(output, filename), Buffer.from(data.data[0].b64_json, "base64"));
    const result = { ...settings, round: round + 1, milliseconds, filename, usage: data.usage };
    results.push(result);
    await writeFile(path.join(output, "results.json"), JSON.stringify({ prepareMs, inputBytes, inputImages: prepared.getAll("image[]").length, promptHash, results }, null, 2));
    console.log(JSON.stringify({ ...settings, round: round + 1, milliseconds }));
  }
}
