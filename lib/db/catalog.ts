import type { CostumeSnapshot, Product } from "../types";
import { validateSnapshot } from "../catalog/validate";
import { getDatabase } from "./client";

export async function ensureSchema(): Promise<void> {
  await getDatabase().execute(`CREATE TABLE IF NOT EXISTS catalog_snapshots (
    slug TEXT PRIMARY KEY,
    snapshot TEXT NOT NULL CHECK (json_valid(snapshot) AND json_extract(snapshot, '$.costume.slug') = slug),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
}

export async function readSnapshots(): Promise<CostumeSnapshot[]> {
  const result = await getDatabase().execute("SELECT snapshot FROM catalog_snapshots ORDER BY slug");
  // Stock may change after publication; sold-out defaults remain visible for swaps.
  return result.rows.map((row) => validateSnapshot(JSON.parse(String(row.snapshot)), false));
}

/** A costume is replaced in one statement, so readers cannot see a partial import. */
export async function upsertSnapshot(input: CostumeSnapshot): Promise<void> {
  const snapshot = validateSnapshot(input);
  await getDatabase().execute({
    sql: `INSERT INTO catalog_snapshots (slug, snapshot) VALUES (?, ?)
      ON CONFLICT(slug) DO UPDATE SET snapshot = excluded.snapshot,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    args: [snapshot.costume.slug, JSON.stringify(snapshot)],
  });
}

export type ProductUpdate = Pick<Product, "id" | "priceCents" | "availability" | "sizes" | "checkedAt">;

/** Patch only verified fields in SQL; concurrent refreshes cannot overwrite whole catalogs. */
export async function updateProducts(updates: ProductUpdate[]): Promise<number> {
  if (!updates.length) return 0;
  const unique = [...new Map(updates.map((item) => [item.id, item])).values()];
  for (const item of unique) {
    if (!Number.isSafeInteger(item.priceCents) || item.priceCents <= 0 || item.priceCents > 99_999_999 ||
      !["in_stock", "out_of_stock"].includes(item.availability) || !Number.isFinite(Date.parse(item.checkedAt)) ||
      !item.sizes.every((size) => typeof size === "string" && size.trim())) {
      throw new Error("Invalid verified product update.");
    }
  }
  const result = await getDatabase().execute({
    sql: `UPDATE catalog_snapshots SET
      snapshot = json_set(snapshot, '$.products', json((
        SELECT json_group_array(json(CASE
          WHEN u.value IS NOT NULL AND julianday(json_extract(u.value, '$.checkedAt')) >= julianday(json_extract(p.value, '$.checkedAt'))
          THEN json_patch(p.value, u.value) ELSE p.value END))
        FROM json_each(snapshot, '$.products') p
        LEFT JOIN json_each(?) u ON json_extract(p.value, '$.id') = json_extract(u.value, '$.id')
      ))), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE EXISTS (
        SELECT 1 FROM json_each(snapshot, '$.products') p JOIN json_each(?) u
        ON json_extract(p.value, '$.id') = json_extract(u.value, '$.id')
      ) RETURNING snapshot`,
    args: [JSON.stringify(unique), JSON.stringify(unique)],
  });
  const stored = result.rows.flatMap((row) => (JSON.parse(String(row.snapshot)) as CostumeSnapshot).products);
  return unique.filter((update) => stored.some((product) => product.id === update.id &&
    Date.parse(product.checkedAt) >= Date.parse(update.checkedAt))).length;
}
