// bun scripts/graph-check.ts — run every catalog query and print results.
// Uses the graph when FALKORDB_URL is set (and also compares it with the snapshot
// implementation), the snapshot otherwise.

// lib/catalog.ts imports "server-only", which only Next resolves; stub it for bun.
type BunLike = { plugin(p: { name: string; setup(b: { module(n: string, f: () => unknown): void }): void }): void };
(globalThis as unknown as { Bun: BunLike }).Bun.plugin({
  name: "server-only-stub",
  setup(build) {
    build.module("server-only", () => ({ exports: {}, loader: "object" }));
  },
});

const { isGraphConfigured, resetGraph } = await import("../lib/graph/client");
const catalog = await import("../lib/catalog");
const graphImpl = await import("../lib/graph/queries");
const snap = await import("../lib/graph/snapshot");

const SLUG = "cosmic-cowboy";
const slim = (o: { product: { id: string; title: string; priceCents: number }; merchant: { id: string }; pick: { rank: number; isLocal: boolean; isCheapest: boolean; path: Array<{ kind: string; label: string }> } }) =>
  `${o.product.id} $${(o.product.priceCents / 100).toFixed(2)} ${o.merchant.id} rank=${o.pick.rank} local=${o.pick.isLocal} cheapest=${o.pick.isCheapest}`;
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures++;
};

try {
  console.log(`source: ${isGraphConfigured() ? "graph (FALKORDB_URL set)" : "snapshot"}`);

  const started = performance.now();
  const view = await catalog.getCostume(SLUG);
  console.log(`Costume read: ${Math.round(performance.now() - started)}ms`);
  check("getCostume", !!view && view.pieces.length > 0, `pieces=${view?.pieces.length}`);
  if (!view || view.pieces.length === 0) throw new Error("Costume has no sourced products; run the sourcing pipeline and seed first");
  check("each piece has one default and two alternatives", view.pieces.every(({ options }) => options.length === 3 && options.every((option, rank) => option.pick.rank === rank)));
  check("each default is in stock", view.pieces.every(({ options }) => options[0].product.availability === "in_stock"));
  for (const pv of view.pieces) {
    console.log(`  ${pv.piece.order} ${pv.piece.id} (${pv.options.length} options)`);
    for (const o of pv.options) console.log(`     ${slim(o)}`);
  }
  console.log("  sample path:", view.pieces[0].options[0].pick.path.map((s) => `${s.kind}:${s.label}`).join(" > "));
  check("getCostume(unknown) is null", (await catalog.getCostume("nope")) === null);

  const first = view.pieces[0];
  const alts = await catalog.getAlternatives(first.piece.id, { costumeSlug: SLUG });
  console.log(`getAlternatives(${first.piece.id}):`, alts.map(slim));
  check("getAlternatives cheapest-first", alts.every((o, i) => i === 0 || alts[i - 1].product.priceCents <= o.product.priceCents));
  const local = await catalog.getAlternatives(first.piece.id, { localOnly: true });
  check("getAlternatives localOnly", local.every((o) => o.pick.isLocal), `n=${local.length}`);
  const cap = alts[0].product.priceCents;
  const capped = await catalog.getAlternatives(first.piece.id, { maxPriceCents: cap });
  check("getAlternatives maxPriceCents inclusive", capped.length >= 1 && capped.every((o) => o.product.priceCents <= cap), `n=${capped.length}`);

  const defaults = view.pieces.map((p) => p.options[0]);
  const defaultIds = defaults.map((o) => o.product.id);
  const mid = defaults[0].merchant.id;
  const mcat = await catalog.getMerchantCatalog(mid, SLUG);
  console.log(`getMerchantCatalog(${mid}):`, mcat.map((o) => `${o.pick.pieceId}:${o.product.id}`));
  check("getMerchantCatalog", mcat.length > 0 && mcat.every((o) => o.merchant.id === mid));

  const po = await catalog.getProductOption(defaultIds[0], first.piece.id);
  check("getProductOption", po?.product.id === defaultIds[0]);
  check("getProductOption(wrong piece) is null", (await catalog.getProductOption(defaultIds[0], "no-such-piece")) === null);
  const pp = await catalog.getPickPath(defaultIds[0], first.piece.id);
  check("getPickPath", !!pp && pp.path.length >= 3);

  // Fewest shops: find a merchant that sells a non-default product for another piece.
  const base = await catalog.getFewestShops(defaultIds);
  console.log("getFewestShops(defaults):", base.map((s) => `${s.merchant.id}=[${s.productIds}]`));
  let proved = false;
  for (const a of view.pieces) {
    for (const b of view.pieces) {
      if (a === b) continue;
      const m = a.options[0].merchant.id;
      const other = b.options.find((o) => o.merchant.id === m && o.pick.rank > 0);
      if (!other) continue;
      const hit = base.find((s) => s.merchant.id === m);
      check(
        `getFewestShops: ${m} (default for ${a.piece.id}) also sells ${other.product.id} for ${b.piece.id}`,
        !!hit && hit.productIds.includes(a.options[0].product.id) && hit.productIds.includes(other.product.id),
        hit ? `-> [${hit.productIds}]` : "-> not returned",
      );
      proved = true;
      break;
    }
    if (proved) break;
  }
  if (!proved) console.log("SKIP no merchant with a cross-piece alternative in this data");
  check("getFewestShops single item is empty", (await catalog.getFewestShops([defaultIds[0]])).length === 0);

  if (isGraphConfigured()) {
    const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    check("graph == snapshot: getCostume", eq(await graphImpl.getCostume(SLUG), await snap.getCostume(SLUG)));
    check("graph == snapshot: getAlternatives", eq(await graphImpl.getAlternatives(first.piece.id), await snap.getAlternatives(first.piece.id)));
    for (const { piece } of view.pieces) {
      for (const filters of [{ costumeSlug: SLUG }, { costumeSlug: SLUG, localOnly: true }, { costumeSlug: SLUG, maxPriceCents: 10000 }]) {
        check(`graph == snapshot: alternatives ${piece.id} ${JSON.stringify(filters)}`, eq(await graphImpl.getAlternatives(piece.id, filters), await snap.getAlternatives(piece.id, filters)));
      }
    }
    check("graph == snapshot: getMerchantCatalog", eq(await graphImpl.getMerchantCatalog(mid, SLUG), await snap.getMerchantCatalog(mid, SLUG)));
    check("graph == snapshot: getFewestShops", eq(await graphImpl.getFewestShops(defaultIds), await snap.getFewestShops(defaultIds)));
    check("graph == snapshot: getPickPath", eq(await graphImpl.getPickPath(defaultIds[0], first.piece.id), await snap.getPickPath(defaultIds[0], first.piece.id)));
    console.log("catalog source:", catalog.getCatalogSource());
    check("served from graph", catalog.getCatalogSource() === "graph");
  }
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await resetGraph();
}
process.exitCode = failures ? 1 : 0;
export {};
