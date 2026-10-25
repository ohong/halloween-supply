// Real screenshot -> Luna -> live search -> merchant checks. Keep supplied photos outside Git.
// bun scripts/verify-screenshot-examples.ts BASE_URL football.jpg pilot.jpg adventurer.jpg
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { isBlockedDomain, isNoiseDomain } from "../lib/sourcing/blocklist";

const [base, ...files] = process.argv.slice(2);
assert(base?.startsWith("http") && files.length === 3, "Provide base URL and the three reference photos in attachment order");
const evidence = process.env.SCREENSHOT_EVIDENCE_DIR;
if (evidence) await mkdir(evidence, { recursive: true });
const summaries = [];
for (const [index, file] of files.entries()) {
  const name = ["football", "pilot", "adventurer"][index];
  const form = new FormData();
  form.set("photo", new File([await readFile(file)], path.basename(file), { type: "image/jpeg" }));
  const response = await fetch(`${base}/api/screenshot-costume`, { method: "POST", body: form, signal: AbortSignal.timeout(40_000) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-vision-model"), "gpt-6-luna");
  assert(response.body);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const output = evidence ? path.join(evidence, `${name}.ndjson`) : null;
  if (output) await writeFile(output, "");
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    text += chunk;
    if (output) await appendFile(output, chunk);
  }
  const events = text.trim().split("\n").map(line => JSON.parse(line));
  assert(!events.some(event => event.t === "error"), `${name}: request must finish`);
  assert(!events.some(event => /search is busy/i.test(event.text ?? "")), "Rate limits must use live fallback instead of cascading busy errors");
  assert(events.some(event => event.kind === "search"), "Every upload needs fresh search");
  const look = events.find(event => event.t === "look"), done = events.find(event => event.t === "done");
  assert(look && done);
  assert(done.ms <= 30_500, "Keep the 30-second work budget");
  assert(!look.pieces.some((piece: { name: string }) => /wig/i.test(piece.name)), "Natural hair must not become a wig");
  const names = look.pieces.map((piece: { name: string }) => piece.name).join(" ");
  const signature = index === 0 ? /horn|viking|helmet/i : index === 1 ? /jacket|bomber/i : /fedora|hat/i;
  assert(signature.test(names));
  if (index === 0) {
    assert(!/Erling|Haaland/i.test(look.character), "Use an outfit title, not a real-person identification");
    assert.match(names, /soccer|football|jersey/i);
    assert.match(names, /cleats|boots|shoes/i);
  } else {
    assert(!look.pieces.some((piece: { slot: string }) => piece.slot === "feet"), "Do not invent footwear outside the crop");
    assert(!/whip|pistol|revolver/i.test(names), "Do not invent hidden character props");
  }
  const matches = new Map<number, { title: string; url: string }>();
  for (const event of events) {
    if (event.t === "candidate") matches.set(event.i, event.match);
    if (event.t === "piece") matches.set(event.i, { title: event.item.title, url: event.item.productUrl });
    if (event.t === "miss") matches.delete(event.i);
  }
  assert.equal(matches.size, done.found);
  assert(matches.size > 0, `${name}: find actual merchant matches`);
  assert(look.pieces.some((piece: { name: string }, i: number) => signature.test(piece.name) && matches.has(i)), `${name}: find the defining piece`);
  for (const match of matches.values()) {
    assert(match.url.startsWith("https://") && !isBlockedDomain(match.url) && !isNoiseDomain(match.url));
    assert(!/jester|knitting kit|yarn kit|sewing pattern/i.test(match.title));
  }
  for (const [i, match] of matches) {
    if (/\bstrap\b/i.test(look.pieces[i].name)) assert(!/\b(jacket|coat|shirt|trousers)\b/i.test(match.title), "A shoulder strap must not become another jacket");
  }
  const priced = events.filter(event => event.t === "piece");
  for (const event of priced) {
    assert(Number.isSafeInteger(event.item.priceCents) && event.item.priceCents > 0);
    assert(event.item.image.startsWith("https://") && event.item.productUrl.startsWith("https://"));
  }
  assert.equal(priced.length, done.priced);
  const summary = { name, title: look.character, model: response.headers.get("x-vision-model"), requested: look.pieces.length,
    discovered: done.found, checkoutReady: done.priced, analysisMs: look.ms,
    firstMatchMs: events.find(event => event.t === "candidate")?.ms, totalMs: done.ms, timedOut: done.timedOut,
    backup: events.some(event => event.kind === "provider"), products: [...matches.values()].map(match => ({ title: match.title, url: match.url })) };
  summaries.push(summary);
  console.log(JSON.stringify(summary));
}
if (evidence) await writeFile(path.join(evidence, "summary.json"), JSON.stringify(summaries, null, 2));
