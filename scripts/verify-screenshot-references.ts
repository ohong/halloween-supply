// Reproduce the two supplied screenshot regressions through the real app and providers.
// Pass the two cropped reference photos as local paths; keep personal uploads outside Git.
// bun scripts/verify-screenshot-references.ts https://halloween.supply /path/cardigan.jpg /path/harness.jpg
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CartItem } from "../lib/types";

const [base, ...files] = process.argv.slice(2);
assert(base?.startsWith("http") && files.length === 2, "Provide base URL, cardigan photo, harness photo");
const output = process.env.SCREENSHOT_EVIDENCE_DIR;
if (output) await mkdir(output, { recursive: true });
const summaries = [];
for (const [index, file] of files.entries()) {
  const form = new FormData();
  form.set("photo", new File([await readFile(file)], path.basename(file), { type: "image/jpeg" }));
  const response = await fetch(`${base}/api/screenshot-costume`, { method: "POST", body: form, signal: AbortSignal.timeout(115_000) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-vision-model"), process.env.OPENAI_VISION_MODEL || "gpt-6.1-sol");
  const text = await response.text();
  if (output) await writeFile(path.join(output, `reference-${index + 1}.ndjson`), text);
  const events = text.trim().split("\n").map((line) => JSON.parse(line));
  assert(!events.some((event) => event.cached || event.kind === "cache" || event.kind === "catalog"), "Uploads must not replay saved results");
  assert(events.some((event) => event.kind === "search"), "Each upload needs fresh Firecrawl discovery");
  const look = events.find((event) => event.t === "look");
  assert(look, `Reference ${index + 1}: no image analysis`);
  assert.match(look.character, /Ryland Grace/i);
  assert.match(look.character, /Project Hail Mary/i);
  assert.equal(look.identityConfidence, "high");
  assert(!look.pieces.some((piece: { name: string }) => /wig|goggles|boots|shoes/i.test(piece.name)), "Do not invent hidden pieces or wigs");
  assert(!events.some((event) => event.t === "error"), "Sourcing must finish");
  const hits = events.filter((event) => event.t === "piece");
  const wanted = index === 0 ? /cardigan/i : /harness/i;
  const signature = hits.find((event) => wanted.test(event.item.pieceName));
  assert(signature, `Reference ${index + 1}: missing defining ${index === 0 ? "cardigan" : "harness"}`);
  for (const event of hits) {
    const item = event.item as CartItem;
    assert(!/goggles|yarn|knit kit|knitting kit|sewing pattern/i.test(item.title));
    assert(item.productUrl.startsWith("https://") && item.image.startsWith("https://"));
    assert(Number.isSafeInteger(item.priceCents) && item.priceCents > 0);
    assert(event.why && /close|exact/.test(event.fit));
  }
  if (index === 1 && signature.item.availableSizes.some((size: string) => /[SML]/.test(size))) assert.equal(signature.item.sizeKind, "apparel");
  const done = events.find((event) => event.t === "done");
  assert.equal(done?.found, hits.length);
  assert.equal(hits.length, look.pieces.length, `Reference ${index + 1}: every requested visible piece must have a verified offer`);
  const summary = { reference: index + 1, character: look.character, model: response.headers.get("x-vision-model"), found: hits.length, requested: look.pieces.length, elapsedMs: done.ms, signature: signature.product };
  summaries.push(summary);
  console.log(JSON.stringify(summary));
}
if (output) await writeFile(path.join(output, "summary.json"), JSON.stringify(summaries, null, 2));
