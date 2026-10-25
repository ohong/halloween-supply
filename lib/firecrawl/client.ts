import { readCache, writeCache } from "../sourcing/cache";

const ENDPOINT = "https://api.firecrawl.dev/v2";

export interface SearchResult {
  title: string;
  url: string;
  description?: string;
  image?: string;
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
}

type RequestOptions = { cache?: boolean; timeoutMs?: number; signal?: AbortSignal };
type SearchOptions = RequestOptions & { limit?: number; excludeDomains?: readonly string[]; retryAt?: number; highlights?: boolean; images?: boolean };

export class FirecrawlError extends Error {
  constructor(public status: number, public retryAfterMs: number, endpoint: string) {
    super(`Firecrawl ${endpoint} failed (HTTP ${status}).`);
  }
}

async function request<T>(endpoint: "search" | "scrape", body: object, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY is not configured.");
  const response = await fetch(`${ENDPOINT}/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.any([AbortSignal.timeout(timeoutMs + 2000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok) {
    const retry = response.headers.get("retry-after");
    const milliseconds = retry && /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 0;
    throw new FirecrawlError(response.status, Math.max(0, milliseconds || 0), endpoint);
  }
  const payload = await response.json() as { success?: boolean; data?: T };
  if (payload.success !== true || !payload.data) throw new Error(`Firecrawl ${endpoint} returned no data.`);
  return payload.data;
}

/** Discover merchant URLs, then scrape only shortlisted product pages. */
export async function searchWeb(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
  const body = { query: query.trim().replace(/\s+/g, " "), limit: opts.limit ?? 10, country: "US", location: "San Francisco,California,United States",
    ...(opts.images ? { sources: ["web", "images"] } : {}),
    ...(opts.highlights !== undefined ? { highlights: opts.highlights } : {}),
    ...(opts.excludeDomains ? { excludeDomains: [...opts.excludeDomains].sort() } : {}),
  };
  if (opts.cache) {
    const hit = await readCache<SearchResult[]>("firecrawl-search", body);
    if (hit) return hit;
  }
  if (opts.retryAt && Date.now() < opts.retryAt) throw new FirecrawlError(429, opts.retryAt - Date.now(), "search");
  const timeout = opts.timeoutMs ?? 25_000;
  const data = await request<{ web?: SearchResult[]; images?: { title: string; url: string; imageUrl: string }[] }>("search", { ...body, timeout }, timeout, opts.signal);
  if (!Array.isArray(data.web)) throw new Error("Firecrawl search returned an invalid result list.");
  const images = opts.images ? (data.images ?? []).filter(item => typeof item.title === "string" && typeof item.url === "string" && typeof item.imageUrl === "string").map(item => ({ title: item.title, url: item.url, image: item.imageUrl })) : [];
  const pageKey = (value: string) => { try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return value; } };
  const imageByPage = new Map(images.map(image => [pageKey(image.url), image.image]));
  const withImages = data.web.map(result => ({ ...result, ...(imageByPage.has(pageKey(result.url)) ? { image: imageByPage.get(pageKey(result.url)) } : {}) }));
  const results = [...withImages, ...images].filter((item) => typeof item.url === "string" && /^https?:\/\//.test(item.url) && typeof item.title === "string");
  if (opts.cache) await writeCache("firecrawl-search", body, results);
  return results;
}

/** rawHtml preserves JSON-LD and variant data. Checkout always bypasses both caches. */
export async function fetchProductPage(url: string, opts: RequestOptions = {}): Promise<FetchedPage> {
  if (opts.cache) {
    const hit = await readCache<FetchedPage>("firecrawl-pages", { url });
    if (hit) return hit;
  }
  const timeout = opts.timeoutMs ?? 25_000;
  const data = await request<{
    rawHtml?: string;
    metadata?: { url?: string; sourceURL?: string; statusCode?: number; error?: string };
  }>("scrape", { url, formats: ["rawHtml"], onlyMainContent: false, maxAge: 0, timeout }, timeout, opts.signal);
  const status = data.metadata?.statusCode ?? 200;
  if (data.metadata?.error || status >= 400 || typeof data.rawHtml !== "string" || data.rawHtml.length < 500) {
    throw new Error("Firecrawl did not return a usable merchant page.");
  }
  const page = { url, finalUrl: data.metadata?.url ?? data.metadata?.sourceURL ?? url, status, html: data.rawHtml };
  if (opts.cache) await writeCache("firecrawl-pages", { url }, page);
  return page;
}
