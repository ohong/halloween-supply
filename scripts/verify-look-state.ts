/** Feature checks against real bundled catalog and running HTTP routes.
 * bun scripts/verify-look-state.ts http://localhost:3342
 * SAVED_LOOK_PERSISTENCE_E2E=1 bun --env-file=.env.local scripts/verify-look-state.ts http://localhost:3342
 * Persistence mode writes one synthetic record, then deletes only that exact record.
 * No sourcing, image generation, merchant request, checkout, or catalog write occurs.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { lookUrl } from "../lib/share-card";
import { readLookSelection, resolveLookSelection, saveLocalLook, readLocalLook, removeLocalLook, type LookSelection } from "../lib/look-selection";
import { SNAPSHOTS } from "../lib/catalog/fallback";
import { getCostume } from "../lib/catalog/queries";
import type { CartItem } from "../lib/types";
import type { MirrorMix } from "../lib/live-mirror/types";
import type { CustomLook } from "../lib/custom-looks/types";

type BunRuntime = { plugin(plugin: { name: string; setup(build: { module(name: string, loader: () => unknown): void }): void }): void };
(globalThis as unknown as { Bun: BunRuntime }).Bun.plugin({ name: "look-state-server-markers", setup(build) { build.module("server-only", () => ({ exports: {}, loader: "object" })); } });
const { signSourcedItem, verifySourcedItem } = await import("../lib/custom-looks/item-proof");
const { isPublicProductUrl } = await import("../lib/custom-looks/public-url");
const origin = new URL(process.argv.find(argument => /^https?:/.test(argument)) ?? "http://localhost:3342").origin;
let checks = 0;
const pass = (label: string) => { checks++; console.log(`PASS ${label}`); };
const base = await getCostume(SNAPSHOTS, "cosmic-cowboy");
assert(base);
const required = base.pieces.find(row => row.piece.required)!;
const optional = base.pieces.find(row => !row.piece.required);
const mixView = (await Promise.all(SNAPSHOTS.map(snapshot => getCostume(SNAPSHOTS, snapshot.costume.slug)))).find(view => view?.costume.slug !== base.costume.slug && view?.pieces.some(row => !base.pieces.some(baseRow => baseRow.piece.id === row.piece.id)));
assert(mixView);
const imported = mixView.pieces.find(row => !base.pieces.some(baseRow => baseRow.piece.id === row.piece.id))!;
const target = base.pieces.find(row => row !== required && row !== optional)!;
const { composeMirrorCostume } = await import("../lib/live-mirror/mixed-outfit");
const mixes: MirrorMix[] = [{ costumeSlug: mixView.costume.slug, pieceId: imported.piece.id, productId: imported.options[0].product.id, replacesPieceId: target.piece.id }];
const view = composeMirrorCostume(base, mixes, [base, mixView]);
const skip = optional?.piece.id ?? imported.piece.id;
// An added/replaced optional piece supplies the skip case when the base has no optional slot.
if (!optional) { mixes[0].replacesPieceId = null; }
const resolvedView = !optional ? composeMirrorCostume(base, mixes, [base, mixView]) : view;
const snapshot: LookSelection = { version: 1, costumeSlug: base.costume.slug, model: "male", mixes,
  selection: resolvedView.pieces.filter(row => row.piece.id !== required.piece.id && row.piece.id !== skip).map(row => ({ pieceId: row.piece.id, productId: row.options[1]?.product.id ?? row.options[0].product.id })),
  ownedPieceIds: [required.piece.id], skippedPieceIds: [skip], previewEdits: { [required.piece.id]: { color: "silver" } } };
const shared = lookUrl(origin, base.costume.slug, snapshot.selection.map(row => row.productId), mixes, snapshot);
const decoded = readLookSelection(new URL(shared).search, base.costume.slug);
assert.equal(decoded.status, "valid");
if (decoded.status !== "valid") throw new Error("The share link could not be read.");
assert.deepEqual(decoded.snapshot, snapshot);
const restored = resolveLookSelection(resolvedView, snapshot);
assert.deepEqual(restored.issues, []);
assert.equal(restored.uses[required.piece.id], "owned"); assert.equal(restored.uses[skip], "skip");
const expectedSubtotal = snapshot.selection.reduce((sum, choice) => sum + resolvedView.pieces.find(row => row.piece.id === choice.pieceId)!.options.find(option => option.product.id === choice.productId)!.product.priceCents, 0);
const restoredSubtotal = resolvedView.pieces.filter(row => restored.uses[row.piece.id] === "buy").reduce((sum, row) => sum + row.options[restored.chosen[row.piece.id]].product.priceCents, 0);
assert.equal(restoredSubtotal, expectedSubtotal);
pass("shared swap, owned required piece, skipped optional piece, mix, model and preview edits restore with identical merchandise subtotal");
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
const sizeProduct = snapshot.selection[0].productId;
assert(saveLocalLook(snapshot, { [sizeProduct]: "M" }));
assert.deepEqual(readLocalLook(base.costume.slug), { snapshot, sizes: { [sizeProduct]: "M" } });
assert(!shared.includes('"sizes"')); assert(!shared.includes('"size"'));
removeLocalLook(base.costume.slug); assert.equal(readLocalLook(base.costume.slug), null);
assert.equal(readLookSelection(`?selection=${encodeURIComponent(JSON.stringify({ ...snapshot, version: 2 }))}`, base.costume.slug).status, "invalid");
assert.equal(readLookSelection("?look=valid-id,%3Cscript%3E", base.costume.slug).status, "invalid");
assert(resolveLookSelection(resolvedView, { ...snapshot, selection: [{ ...snapshot.selection[0], productId: "retired-product" }, ...snapshot.selection.slice(1)] }).issues.length);
const legacy = readLookSelection(`?look=${snapshot.selection.map(row => row.productId).join(",")}&owned=${required.piece.id}&skipped=${skip}&mix=${encodeURIComponent(JSON.stringify(mixes))}&model=male`, base.costume.slug);
assert.equal(legacy.status, "valid");
pass("private sizes stay local; malformed, unsupported and retired selections produce repair information; legacy links remain readable");
for (const url of ["https://127.0.0.1/x", "https://[::1]/x", "https://localhost/x", "https://shop.internal/x", "https://shop.local/x", "http://example.com/x", "https://u:p@example.com/x", "https://example.com:444/x", "https://google.com/x"]) assert.equal(isPublicProductUrl(url, true), false);
pass("saved records reject private, local, credentialed, non-HTTPS and noise product URLs");
const item: CartItem = { pieceId: "verification-boots", pieceName: "Silver boots", sizeKind: "shoe", productId: "1234567890abcdef12345678", title: "Silver western boots — synthetic verification fixture", productUrl: "https://independent-shop.com/products/silver-boots", image: "https://cdn.independent-shop.com/silver-boots.jpg", merchantId: "verification-shop", merchantName: "Verification only", priceCents: 2500, availableSizes: ["8", "9"], size: null };
const proof = signSourcedItem(item); assert(verifySourcedItem(item, proof)); assert(!verifySourcedItem({ ...item, priceCents: 1 }, proof));
const piece = { name: item.pieceName, slot: "feet" as const, query: "silver western costume boots", sizeKind: item.sizeKind };
const missingPiece = { name: "Black hat", slot: "head" as const, query: "black western costume hat", sizeKind: "hat" as const };
const requestId = randomUUID();
const body = { requestId, name: "Saved board verification", summary: "Synthetic record for persistence verification only.", model: "male", pieces: [{ piece, item, proof }, { piece: missingPiece, item: null }] };
async function post(input: unknown, expected: number) {
  const response = await fetch(`${origin}/api/saved-looks`, { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(input) });
  assert.equal(response.status, expected, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return response;
}
await post({ ...body, pieces: [{ piece, item }] }, 400);
await post({ ...body, pieces: [{ piece, item: { ...item, title: "Tampered" }, proof }] }, 400);
await post({ ...body, pieces: [{ piece, item: { ...item, image: "https://127.0.0.1/photo.jpg" }, proof }] }, 400);
pass("real HTTP persistence route rejects unsigned, tampered and unsafe records before database writes");
if (process.env.SAVED_LOOK_PERSISTENCE_E2E !== "1") {
  console.log(`PASS ${checks} feature checks; persistence skipped (requires SAVED_LOOK_PERSISTENCE_E2E=1 and explicit write authorization)`);
  process.exit(0);
}
assert(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN, "Persistence verification requires the existing database credentials.");
const { getDatabase } = await import("../lib/db/client");
let id: string | undefined;
try {
  const saved = await (await post(body, 200)).json() as { id: string; href: string; look: CustomLook }; id = saved.id;
  assert.equal(saved.look.state, "partial"); assert.equal(saved.look.pieces[0].item?.size, null);
  const updated = await (await post({ ...body, pieces: [{ piece, item: { ...item, size: "9" }, proof }, { piece: missingPiece, item: null }] }, 200)).json() as typeof saved;
  assert.equal(updated.id, id); assert.equal(updated.look.pieces[0].item?.size, null);
  const reopened = await fetch(`${origin}/api/saved-looks/${id}`); assert.equal(reopened.status, 200);
  const look = (await reopened.json() as { look: CustomLook }).look;
  assert.deepEqual(look.pieces, saved.look.pieces); assert.equal(look.state, "partial");
  const record = await getDatabase().execute({ sql: "SELECT payload FROM custom_looks WHERE id = ? AND request_id = ?", args: [id, requestId] });
  assert.equal(record.rows.length, 1); const payload = JSON.parse(String(record.rows[0].payload));
  assert.equal(payload.pieces[0].item.size, null); assert(!JSON.stringify(payload).includes("data:image"));
  const { resolvePreviewReferences } = await import("../lib/try-on/references");
  const refs = await resolvePreviewReferences({ savedLookId: id, selected: [{ pieceId: item.pieceId, productId: item.productId }], owned: [], skipped: [], mixes: [] });
  assert.deepEqual(refs.referenceSources, []); assert(refs.descriptions[0].includes(item.title));
  pass("one real database row survives POST, stable-id update and GET with missing piece preserved, sizes stripped and server-resolved product references");
  const photo = await readFile("public/costumes/models/cosmic-cowboy-male.webp");
  const form = new FormData(); form.set("savedLookId", id); form.set("consent", "true"); form.set("photo", new Blob([photo], { type: "image/webp" }), "generated-model.webp");
  form.set("selection", JSON.stringify([{ pieceId: item.pieceId, productId: "invented-product" }]));
  const badPreview = await fetch(`${origin}/api/try-on`, { method: "POST", headers: { origin }, body: form });
  assert.equal(badPreview.status, 400, await badPreview.text());
  form.set("costumeSlug", "cosmic-cowboy");
  const mixedSource = await fetch(`${origin}/api/try-on`, { method: "POST", headers: { origin }, body: form });
  assert.equal(mixedSource.status, 400);
  const retry = await fetch(`${origin}/api/saved-looks/${id}/retry`, { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify({ requestId: randomUUID(), pieceIndex: 0 }) });
  assert.equal(retry.status, 400);
  pass("real photo route rejects invented saved products and mixed sources; retry rejects already-found row without provider calls");
} finally {
  // Capture the exact primary key AND private test request ID. Never delete by name or prefix.
  if (id) {
    const deleted = await getDatabase().execute({ sql: "DELETE FROM custom_looks WHERE id = ? AND request_id = ? RETURNING id", args: [id, requestId] });
    assert.equal(deleted.rows.length, 1);
    const removed = await getDatabase().execute({ sql: "SELECT id FROM custom_looks WHERE id = ? AND request_id = ?", args: [id, requestId] });
    assert.equal(removed.rows.length, 0);
    pass("exact synthetic database row removed and independently confirmed absent");
  }
}
console.log(`PASS ${checks} feature checks. No source images, personal photos, provider inference or merchant validation requested.`);
