import type { Product } from "../types";

// Daily refreshes get a twelve-hour allowance for scheduling and merchant retries.
export const CATALOG_FACT_MAX_AGE_MS = 36 * 60 * 60 * 1000;

export interface CatalogFacts {
  status: "fresh" | "stale" | "unknown";
  evaluatedAt: string;
  maxAgeHours: number;
  products: number;
  fresh: number;
  stale: number;
  missingOrInvalidCheckedAt: number;
  oldestCheckedAt: string | null;
  newestCheckedAt: string | null;
  stock: { inStock: number; outOfStock: number; unknown: number };
}

/** Stored facts describe the catalog only; checkout still verifies each exact offer live. */
export function catalogFacts(products: Pick<Product, "id" | "checkedAt" | "availability">[], now = Date.now()): CatalogFacts {
  const unique = [...new Map(products.map((product) => [product.id, product])).values()];
  const facts: CatalogFacts = {
    status: "unknown", evaluatedAt: new Date(now).toISOString(), maxAgeHours: CATALOG_FACT_MAX_AGE_MS / 3_600_000,
    products: unique.length, fresh: 0, stale: 0, missingOrInvalidCheckedAt: 0,
    oldestCheckedAt: null, newestCheckedAt: null, stock: { inStock: 0, outOfStock: 0, unknown: 0 },
  };
  const checkedTimes: number[] = [];
  for (const product of unique) {
    if (product.availability === "in_stock") facts.stock.inStock++;
    else if (product.availability === "out_of_stock") facts.stock.outOfStock++;
    else facts.stock.unknown++;
    const checkedAt = Date.parse(product.checkedAt);
    // A future timestamp cannot establish freshness. Allow ordinary one-minute clock skew.
    if (!Number.isFinite(checkedAt) || checkedAt > now + 60_000) { facts.missingOrInvalidCheckedAt++; continue; }
    checkedTimes.push(checkedAt);
    if (now - checkedAt > CATALOG_FACT_MAX_AGE_MS) facts.stale++;
    else facts.fresh++;
  }
  if (checkedTimes.length) {
    facts.oldestCheckedAt = new Date(Math.min(...checkedTimes)).toISOString();
    facts.newestCheckedAt = new Date(Math.max(...checkedTimes)).toISOString();
  }
  facts.status = !unique.length || facts.missingOrInvalidCheckedAt > 0 ? "unknown" : facts.stale > 0 ? "stale" : "fresh";
  return facts;
}
