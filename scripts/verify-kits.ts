/** Read-only kit and price checks against the actual bundled catalogs.
 * bun scripts/verify-kits.ts [YYYY-MM-DD event date]
 * No merchant requests, database writes, checkout sessions, or model calls occur.
 */
import assert from "node:assert/strict";
import { KITS } from "../data/kits";
import { SNAPSHOTS } from "../lib/catalog/fallback";
import { getKit, kitSelections, listKits, summarizeCostumes, validateKit } from "../lib/kits";

const summaries = summarizeCostumes(SNAPSHOTS);
const kits = listKits(SNAPSHOTS);
const eventDate = process.argv[2] ?? "2027-10-31";
const failures: string[] = [];
let checks = 0;

function check(label: string, verify: () => void) {
  try { verify(); checks++; }
  catch (error) { failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
}

check("catalog coverage", () => {
  assert.equal(SNAPSHOTS.length, 50, "retain all 50 bundled catalogs");
  assert.equal(summaries.length, SNAPSHOTS.length);
  assert.equal(KITS.length, 10, "publish ten researched completion kits");
  assert.equal(kits.length, KITS.length, "every kit resolves to actual catalog records");
  assert.equal(new Set(KITS.map(({ slug }) => slug)).size, KITS.length, "kit slugs are unique");
  assert.equal(new Set(KITS.map(({ costumeSlug }) => costumeSlug)).size, KITS.length, "one kit per priority costume");
  assert.equal(getKit("missing-kit", SNAPSHOTS), null);
});

for (const snapshot of SNAPSHOTS) {
  check(`${snapshot.costume.slug} full and required price summaries`, () => {
    const summary = summaries.find(({ costumeSlug }) => costumeSlug === snapshot.costume.slug)!;
    const selected = snapshot.pieces.map((piece) => ({
      piece,
      product: snapshot.products.filter((product) => product.availability !== "out_of_stock" && piece.matches.some(({ productId }) => productId === product.id))
        .sort((a, b) => a.priceCents - b.priceCents || a.id.localeCompare(b.id))[0],
    }));
    const missing = selected.filter(({ product }) => !product);
    assert.equal(summary.fullSubtotalCents, missing.length ? null : selected.reduce((sum, { product }) => sum + product!.priceCents, 0));
    assert.equal(summary.requiredSubtotalCents, missing.some(({ piece }) => piece.required) ? null : selected.filter(({ piece }) => piece.required).reduce((sum, { product }) => sum + product!.priceCents, 0));
    assert.equal(summary.unavailablePieceCount, missing.length);
    assert.equal(summary.unknownStockCount, selected.filter(({ product }) => product?.availability === "unknown").length);
  });
}

for (const definition of KITS) {
  check(`${definition.slug} validated references and shopping math`, () => {
    assert.deepEqual(validateKit(definition, SNAPSHOTS), []);
    const kit = getKit(definition.slug, SNAPSHOTS)!;
    assert(kit, "kit must resolve");
    assert.equal(getKit(definition.costumeSlug, SNAPSHOTS)?.slug, kit.slug);
    const snapshot = SNAPSHOTS.find(({ costume }) => costume.slug === definition.costumeSlug)!;
    const selected = kitSelections(kit);
    assert.equal(selected.length, snapshot.pieces.length, "every piece has one disposition");
    assert.equal(new Set(selected.map(({ pieceId }) => pieceId)).size, snapshot.pieces.length);
    const purchased = selected.flatMap((entry) => entry.status === "selected" ? [snapshot.products.find(({ id }) => id === entry.productId)!] : []);
    assert.equal(purchased.reduce((sum, product) => sum + product.priceCents, 0), kit.purchaseSubtotalCents, "only purchased catalog products contribute to the subtotal");
    assert.equal(purchased.length, kit.purchaseCount);
    assert.equal(selected.filter(({ status }) => status === "owned").length, kit.ownedCount);
    assert.equal(selected.filter(({ status }) => status === "skipped").length, kit.skippedCount);
    assert.equal(new Set(purchased.map(({ merchantId }) => merchantId)).size, kit.shopCount);
    assert.equal(purchased.filter(({ availability }) => availability === "unknown").length, kit.unknownStockCount);
    assert.equal(purchased.filter(({ availability }) => availability === "out_of_stock").length, kit.outOfStockCount);
    for (const entry of selected.filter(({ status }) => status !== "selected")) assert(!("productId" in entry), "owned/skipped rows cannot enter the purchase list");
    assert.equal(kit.readiness.eventDate, null);
    assert.notEqual(kit.deliveryStatus, "known_too_late", "an absent event date never invents a deadline");
    const eventKit = getKit(definition.slug, SNAPSHOTS, { eventDate })!;
    assert.equal(eventKit.readiness.eventDate, eventDate, "readiness accepts any event year and date");
    const expectedLateIds = [...new Set(definition.readiness.evidence.flatMap((evidence) => {
      if (!evidence.earliestArrivalDate || evidence.earliestArrivalDate <= eventDate) return [];
      return evidence.productId ? [evidence.productId] : purchased.map(({ id }) => id);
    }))];
    assert.deepEqual(eventKit.readiness.tooLateProductIds, expectedLateIds, "only explicit earliest-arrival evidence excludes purchases");
    assert.equal(eventKit.eligible, !eventKit.outOfStockCount && !expectedLateIds.length);
    const summary = kits.find(({ slug }) => slug === kit.slug)!;
    assert.equal(summary.purchaseSubtotalCents, kit.purchaseSubtotalCents, "gallery and look use the same subtotal");
    assert.deepEqual(summary.ownedBasics, [...kit.owned.map(({ piece }) => piece.name), ...(definition.ownedExtras ?? [])]);
    assert(!("buy" in summary), "gallery summaries do not send complete product records");
    console.log(`${kit.slug}: $${(kit.purchaseSubtotalCents / 100).toFixed(2)} new pieces; ${kit.ownedCount} owned catalog pieces + ${definition.ownedExtras?.length ?? 0} owned extras; ${kit.shopCount} shops; catalog stock unknown ${kit.unknownStockCount}; ${kit.deliveryStatus}${kit.purchaseSubtotalCents > 10_000 ? "; ABOVE $100 TARGET" : ""}`);
  });
}

if (failures.length) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`PASS ${checks} catalog and kit checks; ${KITS.length} kits; ${SNAPSHOTS.length} catalogs. Merchandise subtotals exclude owned pieces, supplies, shipping, and tax.`);
}
