// Bright Data SERP API and Web Unlocker over plain fetch to https://api.brightdata.com/request.
// Env: BRIGHTDATA_API_KEY, BRIGHTDATA_SERP_ZONE, BRIGHTDATA_UNLOCKER_ZONE.
import { parsePriceToCents } from "../products/price";
import { readCache, writeCache } from "../sourcing/cache";

export interface SerpShoppingResult {
  title: string;
  link: string;
  /** Price as printed, e.g. "$48.00". */
  price?: string;
  priceCents?: number;
  source?: string;
  image?: string;
}

export interface SerpOrganicResult {
  title: string;
  link: string;
  description?: string;
}

export interface SerpResult {
  query: string;
  shopping: SerpShoppingResult[];
  organic: SerpOrganicResult[];
}

export interface FetchedPage {
  url: string;
  /** Final URL after redirects when known. */
  finalUrl: string;
  status: number;
  html: string;
}

const ENDPOINT = "https://api.brightdata.com/request";

/** Google `uule` for a canonical location name, e.g. "San Francisco,California,United States". */
export function uuleFor(canonicalName: string): string {
  const KEY = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const b64 = Buffer.from(canonicalName, "utf8").toString("base64").replace(/=+$/, "");
  return `w+CAIQICI${KEY[canonicalName.length] ?? "A"}${b64}`;
}

export const SAN_FRANCISCO_UULE = uuleFor("San Francisco,California,United States");

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}. Set it in .env.local (see .env.example).`);
  return v;
}

export interface SerpUrlOptions {
  shopping?: boolean;
  /** "udm" (udm=28, default) or "tbm" (tbm=shop). Env BRIGHTDATA_SHOPPING_MODE sets the default. */
  shoppingMode?: "udm" | "tbm";
}

export function buildSerpUrl(query: string, opts: SerpUrlOptions = {}): string {
  const p = new URLSearchParams({ q: query, brd_json: "1", gl: "us", hl: "en", uule: SAN_FRANCISCO_UULE });
  if (opts.shopping) {
    const mode = opts.shoppingMode ?? (process.env.BRIGHTDATA_SHOPPING_MODE === "tbm" ? "tbm" : "udm");
    if (mode === "tbm") p.set("tbm", "shop");
    else p.set("udm", "28");
  }
  return `https://www.google.com/search?${p.toString()}`;
}

// ---------------------------------------------------------------------------
// SERP payload parsing (defensive: the shape of `shopping` is unverified)
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return undefined;
};
const firstStr = (o: Rec, keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = o[k];
    const s = str(v) ?? (isRec(v) ? firstStr(v, ["name", "title", "text", "href", "url", "link"]) : undefined);
    if (s) return s;
  }
  return undefined;
};

/** Unwrap Bright Data envelopes ({body: "<json string>"}) and JSON strings. */
export function unwrapSerpPayload(payload: unknown): Rec {
  let p: unknown = payload;
  for (let i = 0; i < 3; i++) {
    if (typeof p === "string") {
      try {
        p = JSON.parse(p);
      } catch {
        return {};
      }
    } else if (isRec(p) && p.body !== undefined && p.organic === undefined && p.shopping === undefined) {
      p = p.body;
    } else break;
  }
  return isRec(p) ? p : {};
}

/** Google redirect links (/url?q=..., /aclk) are unwrapped when they carry the real URL. */
function cleanLink(link: string | undefined): string | undefined {
  if (!link) return undefined;
  try {
    const u = new URL(link, "https://www.google.com");
    if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname === "/url") {
      const real = u.searchParams.get("q") ?? u.searchParams.get("url");
      if (real) return real;
    }
    return u.toString();
  } catch {
    return undefined;
  }
}

export function parseSerpPayload(query: string, payload: unknown): SerpResult {
  const root = unwrapSerpPayload(payload);

  const shoppingRaw: unknown[] = [];
  for (const key of ["shopping", "shopping_results", "popular_products", "products"]) {
    const v = root[key];
    if (Array.isArray(v)) shoppingRaw.push(...v);
    else if (isRec(v)) for (const inner of Object.values(v)) if (Array.isArray(inner)) shoppingRaw.push(...inner);
  }
  const shopping: SerpShoppingResult[] = [];
  for (const item of shoppingRaw) {
    if (!isRec(item)) continue;
    const link = cleanLink(firstStr(item, ["link", "url", "product_link", "shopping_url", "merchant_link", "href"]));
    const title = firstStr(item, ["title", "name", "product_title"]);
    if (!link || !title) continue;
    const priceRaw = item.price ?? item.current_price ?? item.extracted_price ?? item.sale_price;
    const price = firstStr({ p: priceRaw }, ["p"]);
    const priceCents = parsePriceToCents(item.extracted_price ?? priceRaw) ?? undefined;
    const source = firstStr(item, ["source", "shop", "merchant", "merchant_name", "store", "seller", "shop_name"]);
    const image = firstStr(item, ["image", "image_url", "thumbnail", "img"]);
    shopping.push({ title, link, ...(price ? { price } : {}), ...(priceCents !== undefined ? { priceCents } : {}), ...(source ? { source } : {}), ...(image ? { image } : {}) });
  }

  const organic: SerpOrganicResult[] = [];
  const organicRaw = root.organic ?? root.organic_results;
  if (Array.isArray(organicRaw)) {
    for (const item of organicRaw) {
      if (!isRec(item)) continue;
      const link = cleanLink(firstStr(item, ["link", "url", "href"]));
      const title = firstStr(item, ["title", "name"]);
      if (!link || !title) continue;
      const description = firstStr(item, ["description", "snippet", "rich_snippet_text"]);
      organic.push({ title, link, ...(description ? { description } : {}) });
    }
  }
  return { query, shopping, organic };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

class NonRetryable extends Error {}

async function brightDataRequest(
  zone: string,
  url: string,
  timeoutMs: number,
): Promise<{ status: number; headers: Headers; text: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${requireEnv("BRIGHTDATA_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ zone, url, format: "raw" }),
      signal: ctl.signal,
    });
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new NonRetryable(`Bright Data rejected the request (${res.status}): ${text.slice(0, 200)}`);
    }
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      throw new NonRetryable(`Bright Data returned ${res.status} for ${url}: ${text.slice(0, 200)}`);
    }
    if (res.status >= 400) throw new Error(`Bright Data returned ${res.status}`);
    return { status: res.status, headers: res.headers, text };
  } finally {
    clearTimeout(timer);
  }
}

async function withRetries<T>(retries: number, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (e instanceof NonRetryable || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt + Math.random() * 300));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Google search through the SERP zone, located in San Francisco (uule), brd_json=1.
 * shopping=true adds the Shopping search type. Results are not blocklist-filtered here.
 * Extra option cache=true stores the raw response under data/cache/ (pipeline reruns spend no credits).
 */
export async function serpSearch(
  query: string,
  opts: { shopping?: boolean; shoppingMode?: "udm" | "tbm"; cache?: boolean; timeoutMs?: number; retries?: number } = {},
): Promise<SerpResult> {
  const url = buildSerpUrl(query, opts);
  const key = { kind: "serp", url };
  if (opts.cache) {
    const hit = await readCache<unknown>("serp", key);
    if (hit !== undefined) return parseSerpPayload(query, hit);
  }
  const zone = requireEnv("BRIGHTDATA_SERP_ZONE");
  const { text } = await withRetries(opts.retries ?? 2, () => brightDataRequest(zone, url, opts.timeoutMs ?? 45_000));
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`SERP response for "${query}" was not JSON (is brd_json=1 honoured by the zone?): ${text.slice(0, 120)}`);
  }
  if (opts.cache) await writeCache("serp", key, payload);
  return parseSerpPayload(query, payload);
}

/** Raw SERP JSON for one call, for the probe script. Never cached. */
export async function serpRaw(query: string, opts: SerpUrlOptions = {}): Promise<{ url: string; payload: unknown }> {
  const url = buildSerpUrl(query, opts);
  const zone = requireEnv("BRIGHTDATA_SERP_ZONE");
  const { text } = await brightDataRequest(zone, url, 45_000);
  return { url, payload: JSON.parse(text) };
}

/**
 * Fetch a product page through Web Unlocker with a per-attempt timeout and retries.
 * Throws on final failure; callers decide the fallback.
 * Extra option cache=true stores the raw page under data/cache/ (pipeline only; checkout must not).
 */
export async function fetchProductPage(
  url: string,
  opts: { timeoutMs?: number; retries?: number; cache?: boolean } = {},
): Promise<FetchedPage> {
  const key = { kind: "unlocker", url };
  if (opts.cache) {
    const hit = await readCache<FetchedPage>("unlocker", key);
    if (hit && hit.html.length >= 500) return hit;
  }
  const zone = requireEnv("BRIGHTDATA_UNLOCKER_ZONE");
  let page: FetchedPage;
  try {
    const res = await withRetries(opts.retries ?? 0, () => brightDataRequest(zone, url, opts.timeoutMs ?? 12_000));
    if (res.text.length < 500) throw new Error("Web Unlocker returned an empty page");
    const finalUrl = res.headers.get("x-brd-final-url") ?? res.headers.get("x-final-url") ?? url;
    page = { url, finalUrl, status: res.status, html: res.text };
  } catch (unlockerError) {
    // Some independent stores are public and reachable even when the proxy's
    // Unlocker request times out. Check their real page before discarding them.
    try {
      const direct = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0" } });
      const html = await direct.text();
      if (!direct.ok || html.length < 500) throw unlockerError;
      page = { url, finalUrl: direct.url, status: direct.status, html };
    } catch { throw unlockerError; }
  }
  if (opts.cache) await writeCache("unlocker", key, page);
  return page;
}
