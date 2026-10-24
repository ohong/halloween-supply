// Bright Data SERP API and Web Unlocker over plain fetch to https://api.brightdata.com/request.
// Env: BRIGHTDATA_API_KEY, BRIGHTDATA_SERP_ZONE, BRIGHTDATA_UNLOCKER_ZONE.

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

/**
 * Google search through the SERP zone, located in San Francisco (uule), brd_json=1.
 * shopping=true adds the Shopping search type. Results are not blocklist-filtered here.
 */
export async function serpSearch(query: string, opts: { shopping?: boolean } = {}): Promise<SerpResult> {
  void query; void opts;
  throw new Error("not implemented");
}

/**
 * Fetch a product page through Web Unlocker with a per-attempt timeout and retries.
 * Throws on final failure; callers decide the fallback.
 */
export async function fetchProductPage(url: string, opts: { timeoutMs?: number; retries?: number } = {}): Promise<FetchedPage> {
  void url; void opts;
  throw new Error("not implemented");
}
