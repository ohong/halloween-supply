/** Real HTTP acceptance checks. Search may call Anthropic; no checkout occurs.
 * bun scripts/verify-costume-search.ts http://localhost:3402 [--require-semantic]
 * --create explicitly sources and saves ONE real look, then checks its durable URL.
 * --create-query="Waldo with a red-and-white striped shirt and red beanie"
 */
import assert from "node:assert/strict";
import { z } from "zod";
import { costumes } from "../lib/costumes";
import { isBlockedDomain, isNoiseDomain } from "../lib/sourcing/blocklist";

const base = new URL(process.argv.find((argument) => /^https?:\/\//.test(argument)) ?? "http://localhost:3402").origin;
const createEnabled = process.argv.includes("--create");
const requireSemantic = process.argv.includes("--require-semantic");
const knownSlugs = new Set<string>(costumes.map(({ slug }) => slug));
const checks: string[] = [];
const pass = (message: string) => { checks.push(message); console.log(`PASS ${message}`); };
const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
const text = (html: string) => html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
const decode = (value: string) => value.replace(/&amp;/g, "&").replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

const searchSchema = z.object({
  query: z.string(),
  matches: z.array(z.object({ slug: z.string(), relevance: z.enum(["strong", "related"]) })).max(costumes.length),
  hasStrongMatch: z.boolean(),
  source: z.enum(["semantic", "local"]),
});
const pieceSchema = z.object({
  name: z.string().min(1), slot: z.string().min(1), query: z.string().min(1),
  sizeKind: z.enum(["apparel", "pants", "shoe", "hat", "one_size"]),
});
const itemSchema = z.object({
  pieceId: z.string().min(1), pieceName: z.string().min(1),
  sizeKind: pieceSchema.shape.sizeKind,
  productId: z.string().min(1), title: z.string().min(1), productUrl: z.url(), image: z.string().min(1),
  merchantId: z.string().min(1), merchantName: z.string().min(1),
  priceCents: z.number().int().positive(), availableSizes: z.array(z.string()), size: z.string().nullable(),
});
const eventSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("look"), name: z.string().min(1), summary: z.string(), pieces: z.array(pieceSchema).min(1).max(7) }),
  z.object({ t: z.literal("log"), text: z.string() }),
  z.object({ t: z.literal("piece"), i: z.number().int().nonnegative(), item: itemSchema }),
  z.object({ t: z.literal("miss"), i: z.number().int().nonnegative() }),
  z.object({ t: z.literal("done"), id: z.uuid(), href: z.string(), found: z.number().int().nonnegative(), missing: z.number().int().nonnegative() }),
  z.object({ t: z.literal("error"), text: z.string().min(1) }),
]);
type Event = z.infer<typeof eventSchema>;

async function request(route: string, init: RequestInit = {}, timeoutMs = 35_000) {
  return fetch(new URL(route, base), {
    ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
    headers: { Origin: base, ...init.headers },
  });
}

function json(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function rejects(route: string, init: RequestInit, status: number) {
  const response = await request(route, init);
  assert.equal(response.status, status, `${route}: expected HTTP ${status}, received ${response.status}`);
  assert(response.headers.get("content-type")?.includes("application/json"), `${route}: invalid input needs a clear JSON error`);
  const body = await response.json() as { error?: unknown; message?: unknown };
  const error = body.error ?? body.message;
  assert(typeof error === "string" && error.trim(), `${route}: error text is missing`);
  assert(!/sk-(?:live|test|proj)-|ANTHROPIC_API_KEY|TURSO_AUTH_TOKEN/i.test(error), `${route}: error leaks configuration`);
}

async function missingLook(route: string) {
  const response = await request(route);
  if (response.status === 404) return;
  assert.equal(response.status, 200, "Missing look must return 404 or a streamed not-found page");
  const raw = await response.text();
  const html = decode(text(raw));
  // A streamed notFound() signals the browser before hydration renders its boundary.
  assert(/This page could not be found|(?:Costume|Look) not found/i.test(html) || raw.includes("NEXT_HTTP_ERROR_FALLBACK;404"), "A missing look must signal the not-found page");
  assert(/<meta\b[^>]*name="robots"[^>]*content="[^"]*noindex/i.test(html), "A streamed not-found page must be excluded from indexing");
}

async function search(query: string) {
  const started = performance.now();
  const response = await request("/api/costume-search", json({ query }));
  assert.equal(response.status, 200, `Search failed: HTTP ${response.status}`);
  const result = searchSchema.parse(await response.json());
  assert.equal(result.query.toLowerCase(), normalize(query).toLowerCase(), "The search response must identify its normalized query");
  assert(result.matches.every(({ slug }) => knownSlugs.has(slug)), "Search invented a costume ID");
  assert.equal(new Set(result.matches.map(({ slug }) => slug)).size, result.matches.length, "Search returned duplicate costume IDs");
  assert.equal(result.hasStrongMatch, result.matches.some(({ relevance }) => relevance === "strong"), "Strong-match flag contradicts results");
  console.log(`INFO search ${JSON.stringify(normalize(query))}: ${result.source}, ${Math.round(performance.now() - started)} ms`);
  return result;
}

async function stream(response: Response): Promise<Event[]> {
  if (response.status !== 200) throw new Error(`Creation failed: HTTP ${response.status}; ${await response.text()}`);
  assert(response.headers.get("content-type")?.includes("application/x-ndjson"), "Creation must stream its actual work");
  assert(response.body, "Creation response has no body");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const events: Event[] = [];
  let pending = "";
  let bytes = 0;
  const consume = (line: string) => { if (line.trim()) events.push(eventSchema.parse(JSON.parse(line))); };
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.length;
    assert(bytes < 1_000_000, "Creation stream exceeds its expected bounded size");
    pending += next.value;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    lines.forEach(consume);
  }
  consume(pending);
  const failure = events.find((event) => event.t === "error");
  assert(!failure, failure?.t === "error" ? `Creation reported: ${failure.text}` : "Creation failed");
  assert.equal(events.filter((event) => event.t === "done").length, 1, "Creation must finish exactly once");
  return events;
}

async function verifyCreation() {
  const query = process.argv.find((argument) => argument.startsWith("--create-query="))?.slice("--create-query=".length)
    ?? "Waldo with a red-and-white striped shirt and red beanie";
  const body = { query, model: "female", requestId: crypto.randomUUID() };
  const events = await stream(await request("/api/custom-looks", json(body), 180_000));
  const look = events.find((event) => event.t === "look");
  const done = events.find((event) => event.t === "done");
  assert(look?.t === "look" && done?.t === "done", "Creation needs both a real plan and a saved result");
  assert.equal(done.href, `/create/${done.id}`, "Created URL must point to the saved opaque ID");
  const items = events.filter((event) => event.t === "piece");
  const missing = events.filter((event) => event.t === "miss");
  const terminalIndices = [...items, ...missing].map(({ i }) => i);
  assert.equal(new Set(terminalIndices).size, terminalIndices.length, "Each component must resolve once");
  assert(terminalIndices.every((i) => i < look.pieces.length), "Creation returned an unknown component index");
  assert.equal(items.length, done.found);
  assert.equal(missing.length, done.missing);
  assert.equal(done.found + done.missing, look.pieces.length, "Every planned component needs a found or missing result");
  assert(done.found > 0, "A no-product result must not claim successful creation");
  for (const { item } of items) {
    const product = new URL(item.productUrl);
    assert.equal(product.protocol, "https:", "Products must use an HTTPS merchant URL");
    assert(!isBlockedDomain(product.href) && !isNoiseDomain(product.href), "A supplier is blocked or is not a product source");
    assert(!/(^|\.)(halloween\.supply|localhost)$/.test(product.hostname), "Supplier links must lead to actual merchants");
    assert(!/^\/(?:search|collections|category)(?:\/|$)/i.test(product.pathname), "A component needs a product link, not search results");
    assert(item.image.startsWith("/products/") || new URL(item.image).protocol === "https:", "A found product needs a merchant photo");
    const merchant = await fetch(product, { signal: AbortSignal.timeout(20_000), redirect: "follow" }).catch(() => null);
    assert(!merchant || ![404, 410].includes(merchant.status), `${item.title}: the merchant product no longer exists`);
    console.log(`INFO merchant link ${product.hostname}: ${merchant ? `HTTP ${merchant.status}` : "direct fetch unavailable"}`);
    await merchant?.body?.cancel();
  }
  pass(`creation streamed ${done.found} merchant products and ${done.missing} explicit missing components`);

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await request(done.href);
    assert.equal(response.status, 200, "The saved custom look must survive a fresh route load");
    const html = decode(text(await response.text()));
    assert(html.includes(look.name), "Saved page lost its costume name");
    assert(/<meta\b[^>]*name="robots"[^>]*content="[^"]*noindex/i.test(html), "Unlisted looks must be excluded from indexing");
    for (const { item } of items) {
      assert(html.includes(item.title), `Saved page lost ${item.title}`);
      assert(html.includes(item.productUrl), `Saved page lost the merchant link for ${item.title}`);
    }
  }
  pass("saved custom look reloads with real product titles, merchant links, and noindex metadata");

  const repeated = await stream(await request("/api/custom-looks", json(body), 30_000));
  const replay = repeated.find((event) => event.t === "done");
  assert(replay?.t === "done" && replay.id === done.id && replay.href === done.href, "Repeated creation must return the existing look");
  assert.equal(replay.found, done.found);
  assert.equal(replay.missing, done.missing);
  const replayItems = repeated.filter((event) => event.t === "piece");
  if (replayItems.length) {
    assert.deepEqual([...replayItems].sort((a, b) => a.i - b.i), [...items].sort((a, b) => a.i - b.i), "Reopening a completed request must return its original product receipt");
  }
  pass("same request ID reopens the existing saved look and original product receipt");

  const forgedItem = { pieceId: items[0].item.pieceId, productId: "not-a-saved-product", size: null };
  await rejects("/api/checkout", json({ costumeSlug: `custom-look:${done.id}`, items: [forgedItem] }), 400);
  await rejects("/api/checkout", json({ costumeSlug: `custom-look:${crypto.randomUUID()}`, items: [forgedItem] }), 404);
  pass("custom checkout rejects forged products and unknown saved looks before merchant or payment calls");
  console.log(`CREATED ${new URL(done.href, base).href}`);
}

async function main() {
  const response = await request("/");
  assert.equal(response.status, 200);
  const html = text(await response.text());
  assert(/<input\b[^>]*(?:type="search"|role="searchbox")/i.test(html), "Landing page needs the main search field");
  assert(html.includes("What do you want to be?"), "Landing search needs its visible prompt");
  assert.equal((html.match(/class="tile-picture"/g) ?? []).length, costumes.length, "The empty initial search must show every costume");
  for (const { slug } of costumes) assert(html.includes(`${slug}-female.webp`) || html.includes(encodeURIComponent(`${slug}-female.webp`)), `${slug}: default model image missing`);
  pass(`homepage renders the main search and all ${costumes.length} model tiles`);

  await rejects("/api/costume-search", json({ query: true }), 400);
  await rejects("/api/costume-search", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "Velvet Vampire" }, 415);
  await rejects("/api/costume-search", json({ query: "x".repeat(161) }), 400);
  await rejects("/api/costume-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }, 400);
  await rejects("/api/costume-search", json({ query: "x".repeat(70_000) }), 413);
  await rejects("/api/costume-search", { ...json({ query: "Velvet Vampire" }), headers: { "Content-Type": "application/json", Origin: "https://unrelated.invalid" } }, 403);
  assert.equal((await request("/api/costume-search")).status, 405);
  pass("search rejects invalid input, oversized bodies, unsupported methods, and foreign origins");

  const empty = await search("   ");
  assert.equal(empty.source, "local", "Empty search must not require inference");
  const cases = [
    { query: "  Velvet   Vampire  ", expected: "velvet-vampire" },
    { query: "space explorer", expected: "retro-astronaut" },
    { query: "Sherlock Holmes", expected: "victorian-detective" },
    { query: "I want a cream space suit with a helmet for exploring planets", expected: "retro-astronaut" },
  ];
  const sources = new Map<string, number>();
  for (const { query, expected } of cases) {
    const result = await search(query);
    assert(result.matches.some(({ slug, relevance }) => slug === expected && relevance === "strong"), `The catalog must satisfy ${query.trim()}`);
    sources.set(result.source, (sources.get(result.source) ?? 0) + 1);
  }
  const absent = await search("Batman");
  assert.equal(absent.hasStrongMatch, false, "Related dark costumes must not pretend Batman is already in the catalog");
  sources.set(absent.source, (sources.get(absent.source) ?? 0) + 1);
  if (requireSemantic) assert((sources.get("semantic") ?? 0) > 0, "Semantic refinement was required, but every response used local fallback");
  pass(`title, concept, and absent-character searches return known unique IDs; sources ${JSON.stringify(Object.fromEntries(sources))}`);

  const validShape = { query: "An original costume", model: "female", requestId: crypto.randomUUID() };
  await rejects("/api/custom-looks", json({ ...validShape, query: "a" }), 400);
  await rejects("/api/custom-looks", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "An original costume" }, 400);
  await rejects("/api/custom-looks", json({ ...validShape, model: "unknown" }), 400);
  await rejects("/api/custom-looks", json({ ...validShape, requestId: "not-a-uuid" }), 400);
  await rejects("/api/custom-looks", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }, 400);
  await rejects("/api/custom-looks", json({ ...validShape, query: "x".repeat(70_000) }), 413);
  await rejects("/api/custom-looks", { ...json(validShape), headers: { "Content-Type": "application/json", Origin: "https://unrelated.invalid" } }, 403);
  await missingLook("/create/not-a-uuid");
  await missingLook(`/create/${crypto.randomUUID()}`);
  pass("custom creation rejects malformed input and invalid or missing saved-look routes");

  if (createEnabled) await verifyCreation();
  else console.log("INFO custom creation skipped; pass --create to authorize real sourcing and one saved database look");
  console.log(`${checks.length} checks passed against ${base}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Costume search verification failed");
  process.exitCode = 1;
});
