// Real database and query checks. bun --env-file=.env.local scripts/catalog-check.ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readSnapshots } from "../lib/db/catalog";
import * as query from "../lib/catalog/queries";

const snapshots = await readSnapshots();
assert.equal(snapshots.length, 5);
for (const snapshot of snapshots) {
  const view = await query.getCostume(snapshots, snapshot.costume.slug);
  assert(view && view.pieces.length === 5);
  const before = JSON.parse(await readFile(`data/costumes/${snapshot.costume.slug}.json`, "utf8"));
  assert.deepEqual(snapshot, before, "Migration changed the source catalog");
  for (const { piece, options } of view.pieces) {
    assert.equal(options.length, 3);
    const all = await query.getAlternatives(snapshots, piece.id, { costumeSlug: view.costume.slug });
    assert.equal(all.length, 3);
    assert(all.every((o, i) => i === 0 || all[i - 1].product.priceCents <= o.product.priceCents));
    const local = await query.getAlternatives(snapshots, piece.id, { localOnly: true });
    assert(local.every((o) => o.pick.isLocal));
    const capped = await query.getAlternatives(snapshots, piece.id, { maxPriceCents: all[0].product.priceCents });
    assert(capped.length && capped.every((o) => o.product.priceCents <= all[0].product.priceCents));
    const first = options[0];
    assert((await query.getMerchantCatalog(snapshots, first.merchant.id, view.costume.slug)).length);
    assert.equal((await query.getProductOption(snapshots, first.product.id, piece.id))?.product.id, first.product.id);
    assert((await query.getPickPath(snapshots, first.product.id, piece.id))?.path.length);
  }
  const shared = await query.getFewestShops(snapshots, view.pieces.map((p) => p.options[0].product.id));
  assert(shared.every((shop) => shop.productIds.length >= 2));
  console.log(`PASS ${snapshot.costume.slug}: complete migration and catalog queries`);
}
assert.equal(await query.getCostume(snapshots, "unknown-costume"), null);
console.log(`PASS Turso: ${snapshots.length} costumes, ${snapshots.reduce((n,s)=>n+s.products.length,0)} products`);
