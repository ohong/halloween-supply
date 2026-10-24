import "server-only";

import { getGraph, isGraphConfigured } from "../graph/client";
import { SNAPSHOTS } from "../graph/snapshot";
import { getCostume } from "../catalog";
import type { Product } from "../types";
import { verifyProduct } from "./verify";

export interface RefreshChange {
  productId: string;
  field: "price" | "availability";
  from: string | number;
  to: string | number;
}

export interface RefreshSummary {
  checked: number;
  verified: number;
  unverified: { productId: string; reason: string }[];
  changes: RefreshChange[];
  graphWritten: number;
  graphError?: string;
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

/** Re-check price and stock for every product of every live costume; write results to the graph. */
export async function refreshAllProducts(): Promise<RefreshSummary> {
  const products = new Map<string, Product>();
  for (const snap of SNAPSHOTS) {
    if (snap.costume.status !== "live") continue;
    const view = await getCostume(snap.costume.slug);
    for (const pv of view?.pieces ?? []) for (const o of pv.options) products.set(o.product.id, o.product);
  }

  const summary: RefreshSummary = { checked: products.size, verified: 0, unverified: [], changes: [], graphWritten: 0 };
  const updates: { id: string; priceCents: number; availability: string; checkedAt: string }[] = [];

  await mapLimit([...products.values()], CONCURRENCY, async (p) => {
    const v = await verifyProduct(p);
    if (!v.verified) {
      summary.unverified.push({ productId: p.id, reason: v.reason });
      return;
    }
    summary.verified++;
    if (v.priceCents !== p.priceCents) summary.changes.push({ productId: p.id, field: "price", from: p.priceCents, to: v.priceCents });
    // "unknown" never overwrites a known state.
    const availability = v.availability === "unknown" ? p.availability : v.availability;
    if (availability !== p.availability) summary.changes.push({ productId: p.id, field: "availability", from: p.availability, to: availability });
    updates.push({ id: p.id, priceCents: v.priceCents, availability, checkedAt: v.checkedAt });
  });

  if (updates.length && isGraphConfigured()) {
    try {
      const graph = await getGraph();
      await graph.query(
        `UNWIND $rows AS row
         MATCH (p:Product {id: row.id})
         SET p.priceCents = row.priceCents, p.availability = row.availability, p.checkedAt = row.checkedAt`,
        { params: { rows: updates } as never },
      );
      summary.graphWritten = updates.length;
    } catch (e) {
      summary.graphError = e instanceof Error ? e.message : String(e);
      console.error(`[cron/refresh] graph write failed: ${summary.graphError}`);
    }
  } else if (updates.length) {
    summary.graphError = "FALKORDB_URL not set; snapshot is read-only, nothing written";
  }
  return summary;
}
