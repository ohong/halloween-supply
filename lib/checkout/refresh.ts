import "server-only";

import { isDatabaseConfigured } from "../db/client";
import { readSnapshots, updateProducts, type ProductUpdate } from "../db/catalog";
import type { Product } from "../types";
import { verifyProduct } from "./verify";
import { catalogFacts, type CatalogFacts } from "./catalog-facts";

export interface RefreshChange {
  productId: string;
  field: "price" | "availability" | "sizes";
  from: string | number | string[];
  to: string | number | string[];
}

export interface RefreshSummary {
  status: "ok" | "partial" | "error";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  checked: number;
  verified: number;
  unknownStock: number;
  unverified: { productId: string; reason: string }[];
  changes: RefreshChange[];
  databaseWritten: number;
  databaseError?: string;
  factsBefore: CatalogFacts | null;
  /** Re-read from storage after writes, never inferred from attempted updates. */
  factsAfter: CatalogFacts | null;
}

const CONCURRENCY = 5;

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Re-check price and stock for every product of every live costume; write results to the database. */
export async function refreshAllProducts(): Promise<RefreshSummary> {
  const started = Date.now();
  const summary: RefreshSummary = {
    status: "error", startedAt: new Date(started).toISOString(), finishedAt: new Date(started).toISOString(), durationMs: 0,
    checked: 0, verified: 0, unknownStock: 0, unverified: [], changes: [], databaseWritten: 0, factsBefore: null, factsAfter: null,
  };
  const finish = (): RefreshSummary => {
    summary.finishedAt = new Date().toISOString();
    summary.durationMs = Date.now() - started;
    summary.status = summary.databaseError || summary.checked === 0 || summary.verified === 0 ? "error" : summary.unverified.length > 0 ? "partial" : "ok";
    return summary;
  };
  if (!isDatabaseConfigured()) { summary.databaseError = "The database connection is not configured."; return finish(); }
  let products: Product[];
  try {
    const snapshots = await readSnapshots();
    products = [...new Map(snapshots.filter((s) => s.costume.status === "live")
      .flatMap((s) => s.products).map((p) => [p.id, p])).values()];
    summary.checked = products.length;
    summary.factsBefore = catalogFacts(products, started);
  } catch {
    console.error("[cron/refresh] database catalog read failed");
    summary.databaseError = "The database catalog could not be read.";
    return finish();
  }
  if (!products.length) { summary.databaseError = "The database has no live catalog products to refresh."; return finish(); }
  const updates: ProductUpdate[] = [];

  await mapLimit(products, CONCURRENCY, async (p) => {
    try {
      const v = await verifyProduct(p);
      if (!v.verified || v.availability === "unknown") {
        if (v.verified) summary.unknownStock++;
        summary.unverified.push({ productId: p.id, reason: v.verified ? "The merchant did not confirm stock." : v.reason });
        return;
      }
      summary.verified++;
      if (v.priceCents !== Number(p.priceCents)) summary.changes.push({ productId: p.id, field: "price", from: Number(p.priceCents), to: v.priceCents });
      if (v.availability !== p.availability) summary.changes.push({ productId: p.id, field: "availability", from: p.availability, to: v.availability });
      if (JSON.stringify(v.sizes) !== JSON.stringify(p.sizes ?? [])) summary.changes.push({ productId: p.id, field: "sizes", from: p.sizes ?? [], to: v.sizes });
      updates.push({ id: p.id, priceCents: v.priceCents, availability: v.availability, sizes: v.sizes, checkedAt: v.checkedAt });
    } catch {
      summary.unverified.push({ productId: p.id, reason: "The merchant verification could not finish." });
    }
  });

  if (updates.length) {
    try {
      summary.databaseWritten = await updateProducts(updates);
      if (summary.databaseWritten !== updates.length) summary.databaseError = "Some verified products could not be updated in the database.";
    } catch {
      summary.databaseError = "The verified products could not be saved to the database.";
      console.error("[cron/refresh] database write failed");
    }
  }
  try {
    const stored = await readSnapshots();
    summary.factsAfter = catalogFacts(stored.filter((snapshot) => snapshot.costume.status === "live").flatMap((snapshot) => snapshot.products));
  } catch {
    summary.databaseError ??= "The saved catalog facts could not be read after refresh.";
  }
  return finish();
}
