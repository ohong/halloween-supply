/** Real HTTP/database checks. --live also calls Decisions and the catalog reasoning backend. */
import assert from "node:assert/strict";
import type { CostumeView } from "../lib/types";
import type { MirrorCatalogLook, MirrorCommand, MirrorOutfit } from "../lib/live-mirror/types";
import { createOutfit } from "../lib/live-mirror/state";

const origin = process.argv.find(value => /^https?:\/\//.test(value)) ?? "http://localhost:3412";
const headers = { "Content-Type": "application/json", Origin: origin };
const indexResponse = await fetch(`${origin}/api/live-mirror/catalog`, { cache: "no-store" });
assert.equal(indexResponse.status, 200);
const index = await indexResponse.json() as { source: string; looks: MirrorCatalogLook[]; counts: { costumes: number; pieces: number; products: number } };
assert.equal(index.source, "database", "Verify the database catalog, not the bundled fallback");
assert.equal(index.looks.length, index.counts.costumes);
assert(index.looks.length >= 25 && index.counts.products >= 380 && index.counts.pieces >= 100);
assert(index.looks.every(look => look.pieces.length > 0));
console.log("PASS complete database catalog index", index.counts);

const view = await (await fetch(`${origin}/api/live-mirror/catalog?slug=velvet-vampire`)).json() as CostumeView;
assert.equal(view.costume.slug, "velvet-vampire");
const base = { costumeSlug: view.costume.slug, outfit: createOutfit(view) };
async function command(body: object, customHeaders = headers) {
  const response = await fetch(`${origin}/api/live-mirror/command`, {
    method: "POST", headers: customHeaders, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
  });
  return { status: response.status, body: await response.json() as MirrorCommand };
}
assert.equal((await command({ ...base, text: "Search all costumes" }, { ...headers, Origin: "https://example.invalid" })).status, 403);
assert.equal((await command({ ...base, outfit: { ...base.outfit, selection: { ...base.outfit.selection, invented: "forged" } }, text: "Search all costumes" })).status, 400);
assert.equal((await command({ ...base, text: "Try the first result", catalogOnly: true, catalogContext: { query: "old", matches: [{ costumeSlug: "velvet-vampire", pieceId: "invented", productId: "forged" }] } })).status, 409);
console.log("PASS foreign origins, forged outfit IDs and forged search references are rejected");

if (process.argv.includes("--live")) {
  const query = "Search the entire catalog for silver boots below $100. Show options from different costumes. Do not change my outfit.";
  const result = await command({ ...base, text: query });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.actions.length, 0, "A search must not change the outfit");
  const results = result.body.catalogResults;
  assert(results && results.source === "database" && results.matches.length >= 2, JSON.stringify(result.body));
  assert(new Set(results.matches.map(match => match.costumeSlug)).size >= 2);
  assert.equal(new Set(results.matches.map(match => match.productId)).size, results.matches.length);
  for (const match of results.matches) {
    assert(match.option.product.priceCents < 10_000);
    assert.equal(match.option.product.id, match.productId);
    const costume = await (await fetch(`${origin}/api/live-mirror/catalog?slug=${encodeURIComponent(match.costumeSlug)}`)).json() as CostumeView;
    assert(costume.pieces.some(piece => piece.piece.id === match.pieceId && piece.options.some(option => option.product.id === match.productId && option.product.priceCents === match.option.product.priceCents)));
  }
  console.log("PASS real global semantic search returns database products from multiple costumes without edits", results.matches.map(match => ({ costume: match.costumeName, title: match.option.product.title, cents: match.option.product.priceCents })));
  const second = results.matches[1];
  const followup = await command({ ...base, text: "Try the second search result.", catalogContext: {
    query: results.query, matches: results.matches.map(({ costumeSlug, pieceId, productId }) => ({ costumeSlug, pieceId, productId })),
  } });
  assert.equal(followup.status, 200, JSON.stringify(followup.body));
  const action = followup.body.actions.find(action => action.type === "mix");
  assert(action?.type === "mix", JSON.stringify(followup.body));
  assert.equal(action.source.costumeSlug, second.costumeSlug);
  assert.equal(action.source.productId, second.productId);
  const boot = view.pieces.find(row => row.piece.sizeKind === "shoe")!;
  assert.equal(action.replacesPieceId, boot.piece.id);
  async function mix(outfit: MirrorOutfit, actions: MirrorCommand["actions"]) {
    const response = await fetch(`${origin}/api/live-mirror/mix`, { method: "POST", headers,
      body: JSON.stringify({ costumeSlug: base.costumeSlug, outfit, actions }) });
    return { status: response.status, body: await response.json() as { costume: CostumeView; outfit: MirrorOutfit } };
  }
  const applied = await mix(base.outfit, [action]);
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.costume.costume.slug, base.costumeSlug);
  assert.equal(applied.body.outfit.selection[second.pieceId], second.productId);
  assert.equal(applied.body.outfit.selection[boot.piece.id], undefined);
  for (const row of view.pieces.filter(row => row.piece.id !== boot.piece.id)) assert.equal(applied.body.outfit.selection[row.piece.id], base.outfit.selection[row.piece.id]);
  assert.equal(applied.body.costume.pieces.length, view.pieces.length);
  console.log("PASS ordinal follow-up replaces only boots, preserving current costume and all other selections");
  assert.equal((await mix({ ...base.outfit, locked: [boot.piece.id] }, [action])).status, 409);
  assert.equal((await mix(base.outfit, [{ ...action, source: { ...action.source, productId: "forged" } }])).status, 409);
  const forged = await command({ ...base, outfit: { ...applied.body.outfit, mixes: [{ ...applied.body.outfit.mixes![0], productId: "forged" }] }, text: "What am I wearing?" });
  assert.equal(forged.status, 400);
  console.log("PASS locked slots and forged import references are rejected");
  const vague = await command({ costumeSlug: base.costumeSlug, outfit: applied.body.outfit,
    text: "Give me the cheapest pirate captain's headwear from another costume, while keeping my cape and everything else." });
  assert.equal(vague.status, 200, JSON.stringify(vague.body));
  const hat = vague.body.actions.find(action => action.type === "mix");
  assert(hat?.type === "mix", JSON.stringify(vague.body));
  assert.equal(hat.replacesPieceId, null);
  const withHat = await mix(applied.body.outfit, [hat]);
  assert.equal(withHat.status, 200, JSON.stringify(withHat.body));
  assert.equal(withHat.body.costume.costume.slug, base.costumeSlug);
  assert.equal(withHat.body.costume.pieces.length, view.pieces.length + 1);
  assert.equal(withHat.body.outfit.selection[second.pieceId], second.productId);
  assert.equal(withHat.body.outfit.selection[hat.source.pieceId], hat.source.productId);
  console.log("PASS semantic headwear request resolves without exact names and adds an accessory without losing mixed boots");
  const restore = await fetch(`${origin}/api/live-mirror/catalog?slug=${base.costumeSlug}&mix=${encodeURIComponent(JSON.stringify(withHat.body.outfit.mixes))}`);
  assert.equal(restore.status, 200);
  const restored = await restore.json() as CostumeView;
  assert.deepEqual(restored.pieces.map(row => row.piece.id), withHat.body.costume.pieces.map(row => row.piece.id));
  const reference = await fetch(`${origin}/api/live-mirror/reference`, { method: "POST", headers, body: JSON.stringify({
    costumeSlug: base.costumeSlug, selection: withHat.body.outfit.selection, uses: withHat.body.outfit.uses, mixes: withHat.body.outfit.mixes,
  }) });
  assert.equal(reference.status, 200, `Mixed reference failed: ${reference.status}`);
  const board = await reference.json() as { prompt: string; image: null };
  assert.equal(board.image, null, "Merchant model faces must not reach Lucy");
  assert(board.prompt.includes(withHat.body.costume.pieces.find(row => row.piece.id === hat.source.pieceId)!.piece.name));
  console.log("PASS mixed outfit restores from references and produces a clothing-only prompt without merchant faces");
} else console.log("INFO --live enables the real inference checks; no provider calls made");
