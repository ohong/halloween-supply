/** Real no-purchase checks. Starts no checkout and changes no saved catalog.
 * bun --env-file=.env.local scripts/verify-stylist.ts http://localhost:3000
 * Makes three paid styling requests against the running app's configured key.
 * Each request can make bounded grouped Decisions calls for larger catalogs.
 * --costume=SLUG runs the same real-runtime checks against another live catalog.
 * --require-piece-count=6 or =7 requires that real catalog shape in preflight.
 * --preflight-only checks real catalog timing and ownership without API requests.
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { requestedSize, sizeMatches, type PieceUse, type ShoppingBrief } from "../lib/outfits";
import type { CostumeSnapshot, CostumeView } from "../lib/types";
import { getCostume as getSnapshotCostume } from "../lib/catalog/queries";
import { budgetInCents, enumerateOutfits } from "../lib/stylist/candidates";
import { isExplicitlyTooLate, minimumLeadDays } from "../lib/stylist/timing";
import { outfitRequestSchema, StylistError, type OutfitRequest, type StylistResult } from "../lib/stylist/contracts";

type BunRuntime = { plugin(plugin: { name: string; setup(build: { module(name: string, loader: () => unknown): void }): void }): void };
(globalThis as unknown as { Bun: BunRuntime }).Bun.plugin({
  name: "stylist-verification-server-modules",
  setup(build) { build.module("server-only", () => ({ exports: {}, loader: "object" })); },
});

const { getCostume } = await import("../lib/catalog");
const { stylistPhotoEvidence, MAX_STYLIST_PRODUCTS } = await import("../lib/stylist/images");
const { comparisonLimits, measureDecisionEvidence, prepareOutfitComparison } = await import("../lib/stylist/decide");
const base = new URL(process.argv.find((argument) => /^https?:\/\//.test(argument)) ?? "http://127.0.0.1:3300").origin;
const costumeSlug = process.argv.find((argument) => argument.startsWith("--costume="))?.split("=")[1] ?? "cosmic-cowboy";
const view = await getCostume(costumeSlug);
assert(view && view.pieces.length > 0, `A real live ${costumeSlug} catalog is required.`);
const checks: string[] = [];
const pass = (label: string) => { checks.push(label); console.log(`PASS ${label}`); };
const amount = (cents: number) => (cents / 100).toFixed(2);
const optionsFor = (view: CostumeView) => view.pieces.map(({ options }) => options.filter(({ product }) => product.availability !== "out_of_stock" && product.priceCents > 0));
assert(optionsFor(view).every((options) => options.length > 0), "The real catalog must have a buyable option for every piece.");
const minimum = optionsFor(view).reduce((sum, options) => sum + Math.min(...options.map(({ product }) => product.priceCents)), 0);
const maximum = optionsFor(view).reduce((sum, options) => sum + Math.max(...options.map(({ product }) => product.priceCents)), 0);
const brief: ShoppingBrief = { budget: "", eventDate: "", preference: "styling", sizes: {}, notes: "Preserve the costume silhouette. Keep simple pieces affordable; do not spend money just to use the budget." };
const request = (overrides: Partial<ShoppingBrief> = {}, uses: Record<string, PieceUse> = {}): OutfitRequest => ({ costumeSlug: view.costume.slug, brief: { ...brief, ...overrides }, uses });

// Exercise the same preflight code as the route against actual researched product
// records, before any paid API call. No provider success is mocked here.
const moonSnapshot = JSON.parse(await readFile(new URL("../data/costumes/moon-moth.json", import.meta.url), "utf8")) as CostumeSnapshot;
const moonMoth = await getSnapshotCostume([moonSnapshot], "moon-moth");
assert(moonMoth, "The researched Moon Moth catalog is required for timing verification.");
const featherAntennae = moonMoth.pieces.flatMap(({ options }) => options).find(({ product }) => /1\.5[–-]2\.5 weeks creation/.test(product.description));
assert(featherAntennae, "The actual merchant's decimal creation-time evidence must remain in the catalog.");
assert.equal(minimumLeadDays(featherAntennae.product.description), 11, "1.5 weeks must become 11 days, never 5 weeks.");
const dayFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const withNoDate = enumerateOutfits(moonMoth, { ...brief, budget: "", eventDate: "" }, {}).affordable;
assert(withNoDate.some(({ lines }) => lines.some((line) => line.option?.product.id === featherAntennae.product.id)));
const eventSoon = enumerateOutfits(moonMoth, { ...brief, budget: "", eventDate: dayFromNow(3) }, {}).affordable;
assert(eventSoon.every(({ lines }) => lines.every((line) => line.option?.product.id !== featherAntennae.product.id)), "Known late creation time must be excluded before Decisions sees an outfit.");
const eventLater = enumerateOutfits(moonMoth, { ...brief, budget: "", eventDate: dayFromNow(21) }, {}).affordable;
assert(eventLater.some(({ lines }) => lines.some((line) => line.option?.product.id === featherAntennae.product.id)), "A later date must not be incorrectly blocked by decimal parsing.");
const requiredMoonPiece = moonMoth.pieces.find(({ piece }) => piece.required);
assert(requiredMoonPiece);
assert.throws(() => enumerateOutfits(moonMoth, { ...brief, budget: "" }, { [requiredMoonPiece.piece.id]: "skip" }), (error: unknown) => error instanceof StylistError && error.status === 400);
const withOwnedRequired = enumerateOutfits(moonMoth, { ...brief, budget: "" }, { [requiredMoonPiece.piece.id]: "owned" }).affordable;
assert(withOwnedRequired.every(({ lines }) => lines.some((line) => line.view.piece.id === requiredMoonPiece.piece.id && line.use === "owned" && !line.option)));
pass("real Moon Moth creation timing excludes a late decimal-range item without blocking later dates or owned required pieces");
const coralSnapshot = JSON.parse(await readFile(new URL("../data/costumes/coral-mermaid.json", import.meta.url), "utf8")) as CostumeSnapshot;
const longTransit = coralSnapshot.products.find((product) => /18[–-]25 day shipping/.test(product.description));
assert(longTransit, "The real Coral Mermaid shipping-window evidence must remain available.");
assert.equal(minimumLeadDays(longTransit.description), 18);
assert(isExplicitlyTooLate(longTransit, dayFromNow(3)), "A stated 18-day shipping minimum cannot enter a three-day event outfit.");
pass("real Coral Mermaid reverse-worded shipping minimum excludes a known late item");
const vampireSnapshot = JSON.parse(await readFile(new URL("../data/costumes/velvet-vampire.json", import.meta.url), "utf8")) as CostumeSnapshot;
const vampire = await getSnapshotCostume([vampireSnapshot], "velvet-vampire");
assert(vampire);
const exactBrief: ShoppingBrief = { ...brief, budget: "", sizes: { apparel: "Medium" }, pieceSizes: { "black-waistcoat": "42" } };
const exactSizes = enumerateOutfits(vampire, exactBrief, {}).affordable;
assert(exactSizes.length > 0);
for (const candidate of exactSizes) {
  const shirt = candidate.lines.find((line) => line.view.piece.id === "ruffled-shirt")?.option;
  const waistcoat = candidate.lines.find((line) => line.view.piece.id === "black-waistcoat")?.option;
  assert(shirt?.product.sizes.includes("Medium"));
  assert(waistcoat?.product.sizes.includes("42"));
  assert.equal(candidate.total, candidate.lines.reduce((sum, line) => sum + (line.option?.product.priceCents ?? 0), 0));
}
assert.throws(() => enumerateOutfits(vampire, { ...exactBrief, pieceSizes: { "foreign-piece": "42" } }, {}), (error: unknown) => error instanceof StylistError && error.status === 400);
const clearedSizeBrief = { ...exactBrief, pieceSizes: { "black-waistcoat": "" } };
assert(outfitRequestSchema.safeParse({ costumeSlug: vampire.costume.slug, brief: clearedSizeBrief, uses: {} }).success, "An explicit empty per-piece label must suppress a generic fallback without failing the request schema.");
const clearedSizes = enumerateOutfits(vampire, clearedSizeBrief, {}).affordable;
assert(clearedSizes.length > exactSizes.length, "Clearing the waistcoat size must reopen its actual catalog options instead of reusing generic Medium.");
assert(clearedSizes.every(({ unknownSizes }) => unknownSizes.includes(vampire.pieces.find(({ piece }) => piece.id === "black-waistcoat")!.piece.name)));
pass("real merchant shirt Medium and waistcoat 42 coexist with exact prices and scoped per-piece sizes");
const pieceCounts = new Set<number>();
let photoCount = 0;
const catalogDirectory = new URL("../data/costumes/", import.meta.url);
for (const file of (await readdir(catalogDirectory)).filter((name) => name.endsWith(".json")).sort()) {
  const snapshot = JSON.parse(await readFile(new URL(file, catalogDirectory), "utf8")) as CostumeSnapshot;
  const slug = snapshot.costume.slug;
  const actual = await getSnapshotCostume([snapshot], slug);
  assert(actual, `${slug}: the saved real catalog must have complete live picks.`);
  pieceCounts.add(actual.pieces.length);
  const prepared = prepareOutfitComparison(actual, { costumeSlug: slug, brief: { ...brief, budget: "" }, uses: {} });
  const presented = prepared.batches.flatMap((batch) => batch.candidates.map((candidate) => candidate.id));
  assert.deepEqual(presented, prepared.affordable.map((candidate) => candidate.id), `${slug}: every feasible complete outfit must enter exactly one group.`);
  assert.equal(new Set(presented).size, presented.length);
  assert(prepared.batches.length <= comparisonLimits.batches);
  const photos = await stylistPhotoEvidence(slug, snapshot.products);
  photoCount += photos.photoProductIds.length;
  assert.equal(photos.photoProductIds.length, snapshot.products.length, `${slug}: every researched product needs its actual merchant photo.`);
  assert.equal(photos.textOnlyProductIds.length, 0);
  assert.equal(photos.content.filter((part) => part.type === "input_image").length, snapshot.products.length + 1, `${slug}: include one inspiration image and every actual product photo.`);
  assert(photos.content.filter((part) => part.type === "input_image").every((part) => part.image_url.startsWith("data:image/jpeg;base64,")));
  for (const batch of prepared.batches) {
    const measured = measureDecisionEvidence(batch.evidence);
    assert(batch.candidates.length >= 1 && batch.candidates.length <= comparisonLimits.outfitsPerDecision);
    assert(measured.values <= comparisonLimits.jsonValues && measured.bytes <= comparisonLimits.jsonBytes && measured.depth <= comparisonLimits.jsonDepth, `${slug}: every complete-evidence group must fit the real Decisions input limits.`);
    const ids = batch.evidence.products.map((product) => product.id);
    const references = photos.forProducts(ids);
    assert.deepEqual(references.photoProductIds, ids, `${slug}: group photos must match the products used in its complete outfits.`);
    assert.equal(references.content.filter((part) => part.type === "input_image").length, ids.length + 1);
    for (const candidate of batch.candidates) {
      assert.equal(candidate.lines.length, actual.pieces.length);
      assert.equal(candidate.total, candidate.lines.reduce((sum, line) => sum + (line.option?.product.priceCents ?? 0), 0));
      assert(candidate.lines.every((line) => line.option && ids.includes(line.option.product.id)));
    }
  }
  if (actual.pieces.length >= 6) {
    assert(prepared.affordable.length > comparisonLimits.outfitsPerDecision, `${slug}: a real six- or seven-piece catalog must exercise grouped comparison.`);
    assert(prepared.batches.length > 1);
    pass(`${slug}: ${actual.pieces.length} real pieces, ${prepared.affordable.length} complete outfits, ${prepared.batches.length} bounded Decisions groups, and ${photos.photoProductIds.length} actual merchant photos`);
  }
}
const requiredCountText = process.argv.find((argument) => argument.startsWith("--require-piece-count="))?.split("=")[1];
if (requiredCountText) {
  assert(["6", "7"].includes(requiredCountText), "Use --require-piece-count=6 or =7.");
  assert(pieceCounts.has(Number(requiredCountText)), `No real ${requiredCountText}-piece catalog is available. This coverage is not verified.`);
}
pass(`${photoCount} cached merchant photos load, and every saved catalog's complete outfit groups fit Decisions limits`);
if (process.argv.includes("--preflight-only")) {
  console.log("Real catalog preflight checks passed; no API request or catalog mutation occurred.");
  process.exit(0);
}

async function post(body: unknown, extraHeaders: Record<string, string> = {}) {
  const response = await fetch(new URL("/api/outfits", base), {
    method: "POST", headers: { "Content-Type": "application/json", Origin: base, ...extraHeaders },
    body: JSON.stringify(body), signal: AbortSignal.timeout(comparisonLimits.timeoutMs + 15_000), cache: "no-store",
  });
  return { response, body: await response.json() };
}

function verifyResult(result: StylistResult, sent: OutfitRequest) {
  assert.equal(result.method, "decisions", "A successful result must come from the real Decisions API.");
  assert(Number.isSafeInteger(result.candidatesCompared) && result.candidatesCompared >= 1 && result.candidatesCompared <= 5000);
  assert.equal(result.feasibleOutfits, result.candidatesCompared, "Every feasible outfit must reach Decisions.");
  assert.equal(result.candidatesCompared, enumerateOutfits(view!, sent.brief, sent.uses).affordable.length, "The comparison must cover all real catalog combinations that meet the constraints.");
  assert.equal(result.plan.lines.length, view!.pieces.length);
  assert.equal(result.plan.overBudget, false);
  assert.equal(result.plan.missing.length, 0);
  const seen = new Set<string>();
  let subtotal = 0;
  const shops = new Set<string>();
  const unknownSizePieces: string[] = [];
  const unknownStockPieces: string[] = [];
  for (const line of result.plan.lines) {
    const piece = view!.pieces.find(({ piece }) => piece.id === line.view.piece.id);
    assert(piece, "The decision contains a piece outside the real catalog.");
    assert(!seen.has(piece.piece.id), "The decision repeats an outfit piece.");
    seen.add(piece.piece.id);
    assert.equal(line.use, sent.uses[piece.piece.id] ?? "buy");
    if (line.use !== "buy") {
      assert.equal(line.option, undefined, "Owned or skipped pieces must not add a product or price.");
      continue;
    }
    const saved = piece.options.find(({ product }) => product.id === line.option?.product.id);
    assert(saved && line.option, "A chosen product must exist for this exact catalog piece.");
    assert.equal(line.option.product.priceCents, saved.product.priceCents, "Model output cannot change saved prices.");
    assert.equal(line.option.merchant.id, saved.merchant.id);
    assert.equal(line.option.pick.priceTier, saved.pick.priceTier);
    assert.notEqual(saved.product.availability, "out_of_stock");
    assert(sizeMatches(saved, requestedSize(sent.brief, piece.piece)));
    subtotal += saved.product.priceCents;
    shops.add(saved.merchant.id);
    if (saved.product.availability === "unknown") unknownStockPieces.push(piece.piece.name);
    if (piece.piece.sizeKind !== "one_size" && (!requestedSize(sent.brief, piece.piece) || !saved.product.sizes.length)) unknownSizePieces.push(piece.piece.name);
  }
  assert.equal(result.plan.total, subtotal);
  assert.equal(result.plan.shops, shops.size);
  assert.equal(result.evidence.selected.reduce((sum, row) => sum + row.priceCents, 0), subtotal);
  assert.deepEqual(result.evidence.unknownStockPieces, unknownStockPieces);
  assert.deepEqual(result.plan.unknownSizes, unknownSizePieces);
  assert.equal(result.plan.unknownStock, unknownStockPieces.length > 0);
  assert.equal(result.evidence.deliveryConfirmed, false);
  assert.equal(result.evidence.inspirationPhotoIncluded, true);
  assert(result.evidence.photoProductIds.length <= MAX_STYLIST_PRODUCTS);
  const prepared = prepareOutfitComparison(view!, sent);
  const comparison = result.evidence.comparison;
  assert.equal(comparison.batchCount, prepared.batches.length);
  assert.equal(comparison.strategy, prepared.batches.length === 1 ? "single" : "grouped");
  assert(Number.isSafeInteger(comparison.declinedBatchCount) && comparison.declinedBatchCount >= 0);
  assert.equal(comparison.decisionCalls, prepared.batches.length + (prepared.batches.length > 1 ? 1 : 0));
  assert.equal(comparison.finalistsCompared, prepared.batches.length > 1 ? prepared.batches.length - comparison.declinedBatchCount : 0);
  assert.equal(comparison.candidateEvaluations, result.candidatesCompared + comparison.finalistsCompared);
  for (const line of result.plan.lines) {
    if (line.option?.product.merchantImage) assert(result.evidence.photoProductIds.includes(line.option.product.id), "The chosen product's actual photo must be included in the comparison.");
  }
  if (sent.brief.budget) {
    const cents = budgetInCents(sent.brief.budget)!;
    assert(subtotal <= cents, "The stylist must never exceed the shopper's pieces budget.");
    assert.equal(result.evidence.remainingBudget, cents - subtotal);
  }
}

const smallRequest = request({ budget: amount(minimum + Math.floor((maximum - minimum) / 4)) });
const small = await post(smallRequest);
assert.equal(small.response.status, 200, small.body.error);
verifyResult(small.body, smallRequest);
assert.equal(small.body.evidence.minimumSubtotal, minimum);
pass("real Decisions API assembles a complete outfit within a small exact budget");

const largeRequest = request({ budget: amount(maximum), preference: "local" });
const large = await post(largeRequest);
assert.equal(large.response.status, 200, large.body.error);
verifyResult(large.body, largeRequest);
pass("larger budget and merchant preferences still return real catalog IDs and exact prices");

const ownedPiece = view.pieces.find(({ piece }) => piece.required) ?? view.pieces[0];
const optionalPiece = view.pieces.find(({ piece }) => !piece.required && piece.id !== ownedPiece.piece.id);
const uses: Record<string, PieceUse> = { [ownedPiece.piece.id]: "owned", ...(optionalPiece ? { [optionalPiece.piece.id]: "skip" } : {}) };
const ownedRequest = request({ budget: amount(minimum), eventDate: "2026-10-31" }, uses);
const owned = await post(ownedRequest);
assert.equal(owned.response.status, 200, owned.body.error);
verifyResult(owned.body, ownedRequest);
assert.equal(owned.body.plan.lines.find((line: { view: { piece: { id: string } } }) => line.view.piece.id === ownedPiece.piece.id)?.use, "owned");
pass("owned and skipped pieces are preserved without charging for them or claiming event delivery");

const impossible = await post(request({ budget: "0.01" }));
assert.equal(impossible.response.status, 422);
assert.equal(impossible.body.code, "budget_too_low");
assert.equal(impossible.body.minimumSubtotal, minimum);
assert.equal(impossible.body.shortfall, minimum - 1);
assert.equal(impossible.body.plan, undefined);
pass("an impossible budget returns the exact minimum and gap without an over-budget recommendation");

const required = view.pieces.find(({ piece }) => piece.required);
if (required) {
  const skipped = await post(request({}, { [required.piece.id]: "skip" }));
  assert.equal(skipped.response.status, 400);
  pass("required pieces cannot be skipped");
}
const foreign = await post(request(), { Origin: "https://outside.example" });
assert.equal(foreign.response.status, 403);
const malformed = await post(request({ budget: "1.234" }));
assert.equal(malformed.response.status, 400);
const invalidDate = await post(request({ eventDate: "2026-99-99" }));
assert.equal(invalidDate.response.status, 400);
const excessiveNotes = await post(request({ notes: "x".repeat(501) }));
assert.equal(excessiveNotes.response.status, 400);
pass("foreign origins and malformed budget, date, or notes are rejected");

const sizedPiece = view.pieces.find(({ piece, options }) => piece.sizeKind !== "one_size" && options.every(({ product }) => product.sizes.length));
if (sizedPiece) {
  const wrongSize = await post(request({ sizes: { [sizedPiece.piece.sizeKind]: "not-an-offered-size" } }));
  assert.equal(wrongSize.response.status, 422);
  assert.equal(wrongSize.body.code, "no_feasible_outfit");
  assert(wrongSize.body.unavailablePieces.includes(sizedPiece.piece.name));
  pass("a known size mismatch cannot enter a suggested outfit");
}
console.log(`\n${checks.length} real-runtime stylist checks passed; no checkout or catalog mutation occurred.`);
