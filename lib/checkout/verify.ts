import "server-only";

import { fetchProductPage } from "../brightdata/client";
import { parseProduct } from "../products/parse";
import type { Availability, Product } from "../types";

export const VERIFY_TIMEOUT_MS = 10_000;

export type Verification =
  | { verified: true; priceCents: number; availability: Availability; checkedAt: string }
  | { verified: false; reason: string };

/**
 * Re-fetch the live product page and read price and stock from it.
 * One attempt, 10s hard cap. Never throws: any failure becomes { verified: false }
 * so the caller decides (checkout falls back to the stored price and flags it).
 */
export async function verifyProduct(product: Pick<Product, "id" | "url" | "currency">): Promise<Verification> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort();
      reject(new Error(`timed out after ${VERIFY_TIMEOUT_MS}ms`));
    }, VERIFY_TIMEOUT_MS);
  });
  try {
    const page = await Promise.race([
      fetchProductPage(product.url, { timeoutMs: VERIFY_TIMEOUT_MS, retries: 0 }),
      timeout,
    ]);
    const parsed = parseProduct(page.html, page.finalUrl || product.url);
    if (parsed.priceCents === null) return { verified: false, reason: "no price found on page" };
    if (parsed.currency && parsed.currency.toUpperCase() !== "USD") {
      return { verified: false, reason: `unexpected currency ${parsed.currency}` };
    }
    return {
      verified: true,
      priceCents: parsed.priceCents,
      availability: parsed.availability,
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.warn(`[checkout] verify failed for ${product.id} (${product.url}): ${reason}`);
    return { verified: false, reason };
  } finally {
    clearTimeout(timer);
  }
}
