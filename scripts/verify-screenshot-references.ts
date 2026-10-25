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
  const response = await fetch(`${base}/api/screenshot-costume`, { method: "POST", body: form, signal: AbortSignal.timeout(35_000) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-vision-model"), process.env.OPENAI_SCREENSHOT_MODEL || "gpt-6-luna");
  const text = await response.text();
  if (output) await writeFile(path.join(output, `reference-${index + 1}.ndjson`), text);
  const events = text.trim().split("\n").map((line) => JSON.parse(line));
  assert(!events.some((event) => event.cached || event.kind === "cache" || event.kind === "catalog"), "Uploads must not replay saved results");
  assert(events.some((event) => event.kind === "search"), "Each upload needs fresh Firecrawl discovery");
  const look = events.find((event) => event.t === "look");
  assert(look, `Reference ${index + 1}: no image analysis`);
  assert(look.character && look.summary, "Use a descriptive outfit title without blocking on character research");
  assert(!look.pieces.some((piece: { name: string }) => /wig|goggles|boots|shoes/i.test(piece.name)), "Do not invent hidden pieces or wigs");
  assert(!events.some((event) => event.t === "error"), "Sourcing must finish");
  const hits = events.filter((event) => event.t === "piece");
  const wanted = index === 0 ? /cardigan/i : /harness/i;
  const discovered = events.filter(event => event.t === "candidate");
  const signature = hits.find(event => wanted.test(event.item.pieceName)) ?? discovered.find(event => wanted.test(look.pieces[event.i].name));
  assert(signature, `Reference ${index + 1}: missing defining ${index === 0 ? "cardigan" : "harness"}`);
  for (const event of hits) {
    const item = event.item as CartItem;
    assert(!/goggles|yarn|knit kit|knitting kit|sewing pattern/i.test(item.title));
    assert(item.productUrl.startsWith("https://") && item.image.startsWith("https://"));
    assert(Number.isSafeInteger(item.priceCents) && item.priceCents > 0);
    assert(event.why, "Photo checks should explain useful differences");
  }
  if (index === 1 && signature.item && signature.item.availableSizes.some((size: string) => /[SML]/.test(size))) assert.equal(signature.item.sizeKind, "apparel");
  const done = events.find((event) => event.t === "done");
  assert.equal(done?.priced, hits.length);
  assert(done.ms <= 30500);
  assert.equal(new Set(discovered.map(event => event.i)).size, done.found);
  const summary = { reference: index + 1, character: look.character, model: response.headers.get("x-vision-model"), found: done.found, priced: hits.length, requested: look.pieces.length, elapsedMs: done.ms, signature: signature.item ?? signature.match };
  summaries.push(summary);
  console.log(JSON.stringify(summary));
}
if (output) await writeFile(path.join(output, "summary.json"), JSON.stringify(summaries, null, 2));
