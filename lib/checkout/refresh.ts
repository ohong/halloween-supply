import "server-only";

import { isDatabaseConfigured } from "../db/client";
import { readSnapshots, updateProducts, type ProductUpdate } from "../db/catalog";
import type { Product } from "../types";
import { verifyProduct } from "./verify";

export interface RefreshChange {
  productId: string;
  field: "price" | "availability" | "sizes";
  from: string | number | string[];
  to: string | number | string[];
}

export interface RefreshSummary {
  checked: number;
  verified: number;
  unverified: { productId: string; reason: string }[];
  changes: RefreshChange[];
  databaseWritten: number;
  databaseError?: string;
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
  const summary: RefreshSummary = { checked: 0, verified: 0, unverified: [], changes: [], databaseWritten: 0 };
  if (!isDatabaseConfigured()) return { ...summary, databaseError: "The database connection is not configured." };
  let products: Product[];
  try {
    const snapshots = await readSnapshots();
    products = [...new Map(snapshots.filter((s) => s.costume.status === "live")
      .flatMap((s) => s.products).map((p) => [p.id, p])).values()];
    summary.checked = products.length;
  } catch {
    console.error("[cron/refresh] database catalog read failed");
    return { ...summary, databaseError: "The database catalog could not be read." };
  }
  if (!products.length) return { ...summary, databaseError: "The database has no live catalog products to refresh." };
  const updates: ProductUpdate[] = [];

  await mapLimit(products, CONCURRENCY, async (p) => {
    try {
      const v = await verifyProduct(p);
      if (!v.verified || v.availability === "unknown") {
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
  return summary;
}
