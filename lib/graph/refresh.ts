import type { Availability } from "../types";
import { getGraph } from "./client";

// Price/stock refresh for Product nodes. Never touches images or any other property.

export interface ProductRef {
  id: string;
  url: string;
}

export interface ProductRefresh {
  id: string;
  /** null keeps the stored price. */
  priceCents: number | null;
  /** null keeps the stored availability. */
  availability: Availability | null;
  checkedAt: string;
}

export async function listProductRefs(): Promise<ProductRef[]> {
  const graph = await getGraph();
  const res = await graph.roQuery<ProductRef>("MATCH (p:Product) RETURN p.id AS id, p.url AS url ORDER BY p.id");
  return (res.data ?? []).filter((r) => r.id && r.url);
}

/** Returns how many Product nodes were updated. */
export async function refreshProducts(rows: ProductRefresh[]): Promise<number> {
  if (rows.length === 0) return 0;
  const graph = await getGraph();
  const res = await graph.query<{ n: number }>(
    `UNWIND $rows AS row
     MATCH (p:Product {id: row.id})
     SET p.priceCents = coalesce(row.priceCents, p.priceCents),
         p.availability = coalesce(row.availability, p.availability),
         p.checkedAt = row.checkedAt
     RETURN count(p) AS n`,
    { params: { rows } as never },
  );
  return Number(res.data?.[0]?.n ?? 0);
}
