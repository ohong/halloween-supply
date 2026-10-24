import "server-only";

import { getGraph, isGraphConfigured } from "../graph/client";
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
  const summary: RefreshSummary = { checked: 0, verified: 0, unverified: [], changes: [], graphWritten: 0 };
  if (!isGraphConfigured()) return { ...summary, graphError: "The graph connection is not configured." };
  let products: Product[];
  try {
    const graph = await getGraph();
    const result = await graph.roQuery<{ p: { properties: Product } }>(
      `MATCH (c:Costume {status: 'live'})-[:NEEDS]->(:Piece)-[m:MATCHED_BY]->(p:Product)
       WHERE m.costume = c.slug
       RETURN DISTINCT p`,
    );
    products = (result.data ?? []).map((row) => row.p.properties);
    summary.checked = products.length;
  } catch {
    console.error("[cron/refresh] graph catalog read failed");
    return { ...summary, graphError: "The graph catalog could not be read." };
  }
  if (!products.length) return { ...summary, graphError: "The graph has no live catalog products to refresh." };
  const updates: { id: string; priceCents: number; availability: string; sizes: string[]; checkedAt: string }[] = [];

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
      const graph = await getGraph();
      const result = await graph.query<{ updated: number }>(
        `UNWIND $rows AS row
         MATCH (p:Product {id: row.id})
         SET p.priceCents = row.priceCents, p.availability = row.availability,
             p.sizes = row.sizes, p.checkedAt = row.checkedAt
         RETURN count(p) AS updated`,
        { params: { rows: updates } as never },
      );
      summary.graphWritten = Number(result.data?.[0]?.updated ?? 0);
      if (summary.graphWritten !== updates.length) summary.graphError = "Some verified products could not be updated in the graph.";
    } catch {
      summary.graphError = "The verified products could not be saved to the graph.";
      console.error("[cron/refresh] graph write failed");
    }
  }
  return summary;
}
