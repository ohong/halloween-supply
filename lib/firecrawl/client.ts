import { readCache, writeCache } from "../sourcing/cache";

const ENDPOINT = "https://api.firecrawl.dev/v2";

interface SearchResult {
  title: string;
  url: string;
  description?: string;
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
}

type RequestOptions = { cache?: boolean; timeoutMs?: number };

async function request<T>(endpoint: "search" | "scrape", body: object, timeoutMs: number): Promise<T> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY is not configured.");
  const response = await fetch(`${ENDPOINT}/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs + 2000),
  });
  if (!response.ok) throw new Error(`Firecrawl ${endpoint} failed (HTTP ${response.status}).`);
  const payload = await response.json() as { success?: boolean; data?: T };
  if (payload.success !== true || !payload.data) throw new Error(`Firecrawl ${endpoint} returned no data.`);
  return payload.data;
}

/** Discover merchant URLs, then scrape only shortlisted product pages. */
export async function searchWeb(query: string, opts: RequestOptions = {}): Promise<SearchResult[]> {
  const body = { query, limit: 10, country: "US", location: "San Francisco,California,United States", timeout: opts.timeoutMs ?? 25_000 };
  if (opts.cache) {
    const hit = await readCache<SearchResult[]>("firecrawl-search", body);
    if (hit) return hit;
  }
  const data = await request<{ web?: SearchResult[] }>("search", body, body.timeout);
  if (!Array.isArray(data.web)) throw new Error("Firecrawl search returned an invalid result list.");
  const results = data.web.filter((item) => typeof item.url === "string" && /^https?:\/\//.test(item.url) && typeof item.title === "string");
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
  }>("scrape", { url, formats: ["rawHtml"], onlyMainContent: false, maxAge: 0, timeout }, timeout);
  const status = data.metadata?.statusCode ?? 200;
  if (data.metadata?.error || status >= 400 || typeof data.rawHtml !== "string" || data.rawHtml.length < 500) {
    throw new Error("Firecrawl did not return a usable merchant page.");
  }
  const page = { url, finalUrl: data.metadata?.url ?? data.metadata?.sourceURL ?? url, status, html: data.rawHtml };
  if (opts.cache) await writeCache("firecrawl-pages", { url }, page);
  return page;
}
