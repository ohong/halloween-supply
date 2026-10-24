import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { fetchAndParse } from "@/lib/checkout/recheck";
import { isGraphConfigured } from "@/lib/graph/client";
import { listProductRefs, refreshProducts, type ProductRefresh } from "@/lib/graph/refresh";

export const maxDuration = 300;

const CONCURRENCY = 4;
const PRODUCT_TIMEOUT_MS = 15_000;

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Runs fn over items with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Daily refresh of price, availability and checkedAt on every Product node. Images are never touched.
export async function GET(request: Request) {
  await connection(); // request-time only; never prerendered
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (!authorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isGraphConfigured()) return Response.json({ error: "FALKORDB_URL is not configured" }, { status: 500 });

  const started = Date.now();
  let refs;
  try {
    refs = await listProductRefs();
  } catch (e) {
    return Response.json({ error: `Could not read products from the graph: ${(e as Error).message}` }, { status: 502 });
  }

  const updates: ProductRefresh[] = [];
  const failed: { id: string; error: string }[] = [];
  let outOfStock = 0;

  await pool(refs, CONCURRENCY, async (ref) => {
    const res = await fetchAndParse(ref.url, undefined, PRODUCT_TIMEOUT_MS);
    if (!res.ok) {
      failed.push({ id: ref.id, error: res.error });
      return;
    }
    const { priceCents, currency, availability } = res.parsed;
    const price = priceCents !== null && priceCents > 0 && (currency === null || currency.toUpperCase() === "USD") ? priceCents : null;
    const avail = availability === "unknown" ? null : availability;
    if (price === null && avail === null) {
      failed.push({ id: ref.id, error: "no price or availability parsed" });
      return;
    }
    if (avail === "out_of_stock") outOfStock++;
    updates.push({ id: ref.id, priceCents: price, availability: avail, checkedAt: new Date().toISOString() });
  });

  let written = 0;
  try {
    written = await refreshProducts(updates);
  } catch (e) {
    return Response.json({ error: `Graph write failed: ${(e as Error).message}`, fetched: updates.length }, { status: 502 });
  }

  return Response.json({
    ok: true,
    products: refs.length,
    refreshed: written,
    failed: failed.length,
    outOfStock,
    failures: failed.slice(0, 50),
    durationMs: Date.now() - started,
  });
}
