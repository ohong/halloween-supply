import { fetchProductPage } from "../brightdata/client";
import { parseProduct, type ParsedProduct } from "../products/parse";
import type { Availability, Cents } from "../types";
import type { PriceChange } from "./types";

// Pre-checkout re-check: re-fetch each product page once and compare price/stock
// with what the catalog has. Pure apart from the injectable fetcher.

export const RECHECK_TIMEOUT_MS = 10_000;

/** Returns the page HTML, or throws (timeout, network error, HTTP error). */
export type PageFetcher = (url: string, timeoutMs: number) => Promise<string>;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** Bright Data Web Unlocker when configured, otherwise a direct fetch with a browser User-Agent. */
export const defaultPageFetcher: PageFetcher = async (url, timeoutMs) => {
  if (process.env.BRIGHTDATA_API_KEY && process.env.BRIGHTDATA_UNLOCKER_ZONE) {
    const page = await fetchProductPage(url, { timeoutMs, retries: 0 });
    if (page.status >= 400) throw new Error(`HTTP ${page.status}`);
    return page.html;
  }
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

/** Hard deadline on top of the fetcher's own timeout, so a stuck fetcher can never hang checkout. */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms + 500);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

export type FetchParseResult =
  | { ok: true; parsed: ParsedProduct }
  | { ok: false; error: string };

/** Fetch and parse one product page. Never throws. */
export async function fetchAndParse(
  url: string,
  fetcher: PageFetcher = defaultPageFetcher,
  timeoutMs: number = RECHECK_TIMEOUT_MS,
): Promise<FetchParseResult> {
  try {
    const html = await withDeadline(fetcher(url, timeoutMs), timeoutMs);
    return { ok: true, parsed: parseProduct(html, url) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface RecheckInput {
  pieceId: string;
  pieceName: string;
  url: string;
  /** Price in the catalog (cents). */
  storedCents: Cents;
}

export interface RecheckLine {
  pieceId: string;
  pieceName: string;
  /** The price to charge: the freshly parsed one, or the stored one when unverified. */
  priceCents: Cents;
  /** True when the live price could not be confirmed (timeout, fetch error, no price parsed). */
  priceUnverified: boolean;
  availability: Availability;
  /** Set when the live price differs from the stored one. */
  priceChange: PriceChange | null;
  /** Why the price is unverified, for logs. */
  note?: string;
}

export async function recheckOne(
  input: RecheckInput,
  fetcher: PageFetcher = defaultPageFetcher,
  timeoutMs: number = RECHECK_TIMEOUT_MS,
): Promise<RecheckLine> {
  const base = { pieceId: input.pieceId, pieceName: input.pieceName };
  const res = await fetchAndParse(input.url, fetcher, timeoutMs);
  if (!res.ok) {
    return { ...base, priceCents: input.storedCents, priceUnverified: true, availability: "unknown", priceChange: null, note: res.error };
  }
  const { priceCents, currency, availability } = res.parsed;
  const usable = priceCents !== null && priceCents > 0 && (currency === null || currency.toUpperCase() === "USD");
  if (!usable) {
    return {
      ...base,
      priceCents: input.storedCents,
      priceUnverified: true,
      availability,
      priceChange: null,
      note: priceCents === null ? "no price parsed" : `unusable price (${priceCents} ${currency ?? ""})`,
    };
  }
  const changed = priceCents !== input.storedCents;
  return {
    ...base,
    priceCents,
    priceUnverified: false,
    availability,
    priceChange: changed
      ? { pieceId: input.pieceId, pieceName: input.pieceName, oldCents: input.storedCents, newCents: priceCents }
      : null,
  };
}

/** Re-check every line in parallel. Results are in input order. */
export function recheckAll(
  inputs: RecheckInput[],
  fetcher: PageFetcher = defaultPageFetcher,
  timeoutMs: number = RECHECK_TIMEOUT_MS,
): Promise<RecheckLine[]> {
  return Promise.all(inputs.map((i) => recheckOne(i, fetcher, timeoutMs)));
}
