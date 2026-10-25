import "server-only";

import { isDatabaseConfigured } from "./db/client";
import { readSnapshots } from "./db/catalog";
import { SNAPSHOTS } from "./catalog/fallback";
import * as query from "./catalog/queries";
import type { AlternativeFilters, CostumeSnapshot, CostumeView, PickReason, ProductOption, SharedMerchant } from "./types";

export type CatalogSource = "database" | "snapshot";
let retryAfter = 0;

/** The source is returned with its data, so concurrent requests cannot misreport it. */
export async function readCatalogs(): Promise<{ source: CatalogSource; snapshots: CostumeSnapshot[] }> {
  if (isDatabaseConfigured() && performance.now() >= retryAfter) {
    try {
      const snapshots = await readSnapshots();
      if (!snapshots.length) throw new Error("Empty catalog");
      retryAfter = 0;
      return { source: "database", snapshots };
    } catch {
      retryAfter = performance.now() + 30_000;
      console.warn("[catalog] database unavailable; serving bundled catalogs and retrying in 30 seconds");
    }
  }
  return { source: "snapshot", snapshots: SNAPSHOTS };
}

export async function getCostume(slug: string): Promise<CostumeView | null> {
  return query.getCostume((await readCatalogs()).snapshots, slug);
}

export async function getAlternatives(pieceId: string, opts: AlternativeFilters = {}): Promise<ProductOption[]> {
  return query.getAlternatives((await readCatalogs()).snapshots, pieceId, opts);
}

export async function getMerchantCatalog(merchantId: string, costumeSlug: string): Promise<ProductOption[]> {
  return query.getMerchantCatalog((await readCatalogs()).snapshots, merchantId, costumeSlug);
}

export async function getFewestShops(productIds: string[]): Promise<SharedMerchant[]> {
  return query.getFewestShops((await readCatalogs()).snapshots, productIds);
}

export async function getPickPath(productId: string, pieceId: string): Promise<PickReason | null> {
  return query.getPickPath((await readCatalogs()).snapshots, productId, pieceId);
}

export async function getProductOption(productId: string, pieceId: string): Promise<ProductOption | null> {
  return query.getProductOption((await readCatalogs()).snapshots, productId, pieceId);
}
