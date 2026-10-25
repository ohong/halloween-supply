import { setTimeout as delay } from "node:timers/promises";
import { FirecrawlError, fetchProductPage, searchWeb, type SearchResult } from "../firecrawl/client";
import { htmlToText, parseProduct } from "../products/parse";
import { readShopifyProduct, selectShopifyVariants, shopifySizes } from "../products/shopify";
import { BLOCKED_DOMAINS, NOISE_DOMAINS, hostnameOf, isBlockedDomain, isNoiseDomain, registrableDomain } from "./blocklist";
import { readCache, writeCache } from "./cache";
import type { Product } from "../types";

export interface ScreenshotPiece { name: string; query: string }
export interface ScreenshotProduct { title: string; image: string; url: string; priceCents: number; merchant: string; sizes: string[] }
export type SourcingLog = (kind: string, text: string) => void;

const EXCLUDED = [...BLOCKED_DOMAINS, ...NOISE_DOMAINS, "alibaba.com", "dhgate.com", "made-in-china.com"];
// Preserve the precise first query. Domain exclusions are reserved for the broader fallback.
const SEARCH_EXCLUDED = ["amazon.com", "ebay.com", "pinterest.com"];
const SHOPIFY = /\/products\/[^/]+\/?$/i;
const PRODUCT = /\/(listing\/\d+|products?\/|item\/|itm\/|p\/|dp\/)|[?&](variant|pid)=|\/[\w-]+-p\d+|\.html?$/i;
const LISTING = /\/(market|search|c|category|categories|collections|tag|blogs?|articles?|news)(\/|\?|$)/i;
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/);

// Check garment nouns in the merchant title, not a snippet describing related products.
// Specific categories precede broad terms: a dress shirt is a shirt, not a dress.
const KINDS = [
  /\b(boots?|booties)\b/i, /\b(shoes?|heels?|loafers?|sneakers?|pumps?|sandals?)\b/i,
  /\b(headbands?|headpieces?|tiaras?|crowns?|circlets?)\b/i, /\b(hats?|beanies?|berets?|caps?|bonnets?)\b/i,
  /\b(wigs?)\b/i, /\b(masks?)\b/i, /\b(glasses|spectacles|goggles)\b/i,
  /\b(collars?)\b/i, /\b(scarf|scarves|neckerchiefs?|bandanas?|wild\s?rags?)\b/i,
  /\b(vests?|waistcoats?)\b/i, /\b(shirts?|blouses?|tops?)\b/i,
  /\b(overalls?|shortalls?|dungarees|pinafores?|rompers?)\b/i,
  /\b(pants?|trousers?|leggings?|jeans|bottoms?|breeches|shorts?)\b/i,
  /\b(catsuits?|unitards?|jumpsuits?)\b/i, /\b(bodysuits?|leotards?)\b/i,
  /\b(wings?)\b/i, /\b(capes?|cloaks?)\b/i, /\b(jackets?|coats?|blazers?)\b/i,
  /\b(skirts?)\b/i, /\b(dresses|dress|gowns?)\b/i, /\b(gloves?|gauntlets?)\b/i,
  /\b(belts?|sashes?)\b/i, /\b(brooch|brooches|pins?)\b/i, /\b(necklaces?|pendants?|chokers?)\b/i,
  /\b(tights|stockings|socks?)\b/i, /\b(bags?|purses?|satchels?)\b/i,
];
const COLORS = [
  ["black", "ebony"], ["white", "ivory", "cream"], ["silver", "pewter"], ["gold", "golden"],
  ["red", "burgundy", "maroon", "crimson"], ["blue", "navy", "cobalt"], ["green", "olive", "sage", "emerald"],
  ["purple", "lilac", "lavender", "violet"], ["pink", "rose", "fuchsia"], ["brown", "tan", "beige", "camel"],
  ["yellow", "mustard"], ["orange", "coral"], ["gray", "grey", "charcoal"], ["teal", "turquoise", "aqua"],
];
const wordsMatch = (s: string, words: string[]) => words.some((word) => new RegExp(`\\b${word}\\b`, "i").test(s));
const desiredColors = (piece: ScreenshotPiece) => COLORS.filter((group) => wordsMatch(piece.query, group))
  .sort((a, b) => piece.query.search(new RegExp(`\\b(${a.join("|")})\\b`, "i")) - piece.query.search(new RegExp(`\\b(${b.join("|")})\\b`, "i")));
const kindOf = (piece: ScreenshotPiece) => KINDS.find((kind) => kind.test(`${piece.name} ${piece.query}`));
const DETAILS = [
  /\b(fringe|fringed|tassels?|tasseled)\b/i, /\b(ruffle[ds]?|frill[sy]?|jabot)\b/i,
  /\b(flare[ds]?|bell[ -]?bottoms?)\b/i, /\b(stripes?|striped)\b/i,
  /\b(velvet|velour)\b/i, /\b(brocade|jacquard)\b/i, /\b(satin|silk)\b/i,
  /\b(holographic|hologram|iridescent|holo)\b/i, /\b(fur|furry)\b/i,
  /\b(leaf|leaves|laurel)\b/i,
  /\b(slim|skinny|tapered)\b/i, /\b(leather|suede)\b/i,
  /\b(moth|luna)\b/i,
  /\b(corduroy|cord)\b/i, /\b(puff|puffed|puffy)\b/i, /\b(ribbed|rib)\b/i,
];
const allowedHost = (host: string) => !isBlockedDomain(host) && !isNoiseDomain(host) && !EXCLUDED.some((domain) => host === domain || host.endsWith(`.${domain}`));
function wrongAudience(piece: ScreenshotPiece, text: string) {
  return [
    /\b(kids?|children|child|toddler|infant|baby|youth)\b/i,
    /\b\d+\s*(?:[-–]\s*\d+\s*)?(?:years?|months?|yrs?|mos?)\b/i,
    /\b(doll|dollhouse|miniature|dog|pet)\b/i,
    /\b(pattern|tutorial|download|printable|charm|ornament|keychain|hand fan)\b/i,
    /\b(rent|rental)\b/i,
  ].some((kind) => kind.test(text) && !kind.test(`${piece.name} ${piece.query}`));
}

export function matchesScreenshotPiece(piece: ScreenshotPiece, title: string, colorEvidence = title, details = title): boolean {
  if (wrongAudience(piece, title)) return false;
  const kind = kindOf(piece);
  if (kind ? !kind.test(title) : !tokens(piece.name).some((word) => word.length > 3 && tokens(title).includes(word))) return false;
  if (/\b(dress|formal|tailored|tuxedo)\s+(pants?|trousers?|shoes?)\b/i.test(piece.query)
    && !/\b(dress|formal|tailored|tuxedo|wedding|oxfords?|derby|derbies|brogues?)\b/i.test(details)) return false;
  return desiredColors(piece).every((group) => wordsMatch(colorEvidence, group))
    && DETAILS.filter((detail) => detail.test(piece.query)).every((detail) => detail.test(details));
}

function relevance(piece: ScreenshotPiece, result: SearchResult): number {
  const title = tokens(result.title);
  const kind = kindOf(piece);
  return (kind?.test(result.title) ? 20 : 0)
    + desiredColors(piece).filter((group) => wordsMatch(result.title, group)).length * 8
    + tokens(piece.query).filter((word) => word.length > 2 && title.includes(word)).length * 2;
}

// Bound account pressure across concurrent looks. Queue time and retries share the request deadline.
let activeSearches = 0;
let searchRetryAt = 0;
const waiting: { run: () => void; signal: AbortSignal }[] = [];
async function searchSlot(signal: AbortSignal) {
  signal.throwIfAborted();
  if (activeSearches < 3) { activeSearches++; return; }
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      const index = waiting.indexOf(entry);
      if (index >= 0) waiting.splice(index, 1);
      reject(signal.reason);
    };
    const entry = { signal, run: () => { signal.removeEventListener("abort", abort); activeSearches++; resolve(); } };
    waiting.push(entry);
    signal.addEventListener("abort", abort, { once: true });
  });
}
function releaseSearch() {
  activeSearches--;
  let next;
  while ((next = waiting.shift())) {
    if (!next.signal.aborted) { next.run(); break; }
  }
}

export function screenshotSourcing(signal: AbortSignal, log: SourcingLog, catalog: readonly Product[] = []) {
  const searches = new Map<string, Promise<SearchResult[]>>();
  const currencies = new Map<string, Promise<string | null>>();
  async function search(query: string, broad: boolean) {
    const key = `${broad}:${query}`;
    let pending = searches.get(key);
    if (!pending) {
      pending = (async () => {
        await searchSlot(signal);
        try {
          for (let attempt = 0; ; attempt++) {
            try {
              // Disk hits remain usable during a provider cooldown.
              return await searchWeb(query, { cache: true, timeoutMs: 6_000, signal,
                ...(broad ? { excludeDomains: SEARCH_EXCLUDED } : {}), retryAt: searchRetryAt });
            }
            catch (error) {
              if (!(error instanceof FirecrawlError) || error.status !== 429) throw error;
              searchRetryAt = Date.now() + (error.retryAfterMs || 30_000);
              if (attempt || !error.retryAfterMs || error.retryAfterMs > 2_000) throw error;
              log("retry", "Search is busy. Retrying once…");
              await delay(Math.max(1_000, error.retryAfterMs), undefined, { signal });
            }
          }
        } finally { releaseSearch(); }
      })();
      searches.set(key, pending);
    }
    return pending;
  }

  function currency(origin: string) {
    let pending = currencies.get(origin);
    if (!pending) {
      pending = (async () => {
        const cached = await readCache<string>("shop-currency", origin);
        if (cached) return cached;
        try {
          const response = await fetch(`${origin}/cart.js`, { signal: AbortSignal.any([signal, AbortSignal.timeout(2_500)]), headers: { Accept: "application/json" } });
          const cart = response.ok ? await response.json() as { currency?: string } : null;
          const value = typeof cart?.currency === "string" ? cart.currency : null;
          if (value) await writeCache("shop-currency", origin, value);
          return value;
        } catch { return null; }
      })();
      currencies.set(origin, pending);
    }
    return pending;
  }

  async function readShopify(url: string, piece: ScreenshotPiece, readSignal: AbortSignal): Promise<ScreenshotProduct | null> {
    const [product, money] = await Promise.all([readShopifyProduct(url, true, { signal: readSignal, timeoutMs: 3_500 }), currency(new URL(url).origin)]);
    if (!product?.title || money !== "USD") return null;
    // Match color options on the chosen variant. A title cannot override an explicit wrong color.
    const colorIndex = product.options.findIndex((option) => /colou?r/i.test(typeof option === "string" ? option : option.name));
    const purchaseIndex = product.options.findIndex((option) => /purchase\s*(type|option)/i.test(typeof option === "string" ? option : option.name));
    const candidates = selectShopifyVariants(product);
    // The cheapest family might be the wrong color, so inspect each available family.
    const anchors = [...candidates, ...product.variants.filter((variant) => variant.available)];
    for (const anchor of anchors) {
      if (wrongAudience(piece, `${anchor.title} ${(anchor.options ?? []).join(" ")}`)) continue;
      const purchase = purchaseIndex < 0 ? null : ([anchor.option1, anchor.option2, anchor.option3][purchaseIndex] ?? anchor.options?.[purchaseIndex]);
      if (purchase && !/^(buy|purchase)$/i.test(purchase)) continue;
      const color = colorIndex < 0 ? product.title : ([anchor.option1, anchor.option2, anchor.option3][colorIndex] ?? anchor.options?.[colorIndex] ?? "");
      const detail = `${product.title} ${htmlToText(product.description ?? "")}`;
      const colors = desiredColors(piece);
      if (colorIndex >= 0 && colors.length && !wordsMatch(color, colors[0])) continue;
      // Secondary colors can describe lining or spots, which do not get their own variant option.
      if (!matchesScreenshotPiece(piece, product.title, colors.length > 1 ? `${color} ${detail}` : color, detail)) continue;
      const variant = selectShopifyVariants(product, undefined, String(anchor.id))[0];
      const image = [variant?.featured_image?.src, ...product.images].find((src) => typeof src === "string" && /^(https:)?\/\//.test(src))?.replace(/^\/\//, "https://");
      const sizes = variant ? shopifySizes(product, variant) : [];
      if (!variant || !Number.isSafeInteger(variant.price) || variant.price <= 0 || !image || !sizes.length) continue;
      const productUrl = new URL(url);
      productUrl.search = "";
      productUrl.searchParams.set("variant", String(variant.id));
      return { title: product.title, image, url: productUrl.toString(), priceCents: variant.price, merchant: registrableDomain(productUrl.hostname)!, sizes };
    }
    return null;
  }

  async function scrape(url: string, piece: ScreenshotPiece, readSignal: AbortSignal): Promise<ScreenshotProduct | null> {
    try {
      const page = await fetchProductPage(url, { cache: true, timeoutMs: 5_000, signal: readSignal });
      const host = hostnameOf(page.finalUrl);
      if (!host || !allowedHost(host) || !page.finalUrl.startsWith("https://")) return null;
      const product = parseProduct(page.html, page.finalUrl);
      const image = product.images.find((src) => src.startsWith("https://"));
      if (!product.title || !matchesScreenshotPiece(piece, product.title, product.title, `${product.title} ${product.description ?? ""}`) || !product.priceCents || product.priceCents <= 0 || product.currency !== "USD" || !image || product.availability !== "in_stock") return null;
      return { title: product.title, image, url: page.finalUrl, priceCents: product.priceCents, merchant: registrableDomain(host)!, sizes: product.sizes };
    } catch { return null; }
  }

  async function readCandidates(results: SearchResult[], piece: ScreenshotPiece, seen: Set<string>) {
    const perHost = new Map<string, number>();
    const candidates: SearchResult[] = [];
    for (const result of [...results].sort((a, b) => relevance(piece, b) - relevance(piece, a))) {
      try {
        const url = new URL(result.url);
        const host = hostnameOf(result.url)!;
        if (url.protocol !== "https:" || !allowedHost(host) || wrongAudience(piece, `${result.title} ${url.pathname.replace(/-/g, " ")}`)) continue;
        if (!SHOPIFY.test(url.pathname) && (LISTING.test(url.pathname) || !PRODUCT.test(url.pathname + url.search))) continue;
        url.hash = ""; url.search = "";
        if (seen.has(url.toString()) || (perHost.get(host) ?? 0) >= 2) continue;
        seen.add(url.toString()); perHost.set(host, (perHost.get(host) ?? 0) + 1);
        candidates.push(result);
        if (candidates.length === 4) break;
      } catch { /* Ignore malformed discovery URLs. */ }
    }
    // Race only relevant, verified products. One stalled merchant cannot hold up a good match.
    const reads = new AbortController();
    const readSignal = AbortSignal.any([signal, reads.signal]);
    try {
      return await Promise.any(candidates.map(async ({ url }) => {
        log("candidate", `${piece.name}: ${hostnameOf(url)}`);
        const hit = SHOPIFY.test(new URL(url).pathname) ? await readShopify(url, piece, readSignal) : await scrape(url, piece, readSignal);
        if (!hit) throw new Error("No verified match");
        return hit;
      }));
    } catch { return null; }
    finally { reads.abort(); }
  }

  return async (piece: ScreenshotPiece): Promise<ScreenshotProduct | null> => {
    const seen = new Set<string>();
    // Reviewed URLs are discovery hints, never price/stock answers. Re-read the merchant before use.
    const known = catalog.filter((product) => product.availability === "in_stock"
      && matchesScreenshotPiece(piece, product.title, `${product.title} ${product.description}`, `${product.title} ${product.description}`))
      .map((product) => ({ title: product.title, url: product.url }))
      .sort((a, b) => relevance(piece, b) - relevance(piece, a));
    const unique = [...new Map(known.map((item) => [item.url.split("?")[0], item])).values()].slice(0, 4);
    if (unique.length) {
      log("catalog", `${piece.name}: checking previously sourced shops`);
      const hit = await readCandidates(unique, piece, seen);
      if (hit) return hit;
    }
    // Keep the fast Shopify path, then widen discovery when every candidate fails validation.
    // Generic audience suffixes often return category pages instead of the pictured garment.
    const productQuery = piece.query.replace(/\b(?:for\s+)?(?:men['’]?s?|women['’]?s?)\b/gi, " ").replace(/\s+/g, " ").trim();
    const adultQuery = /\b(kids?|children|child|toddler|infant|baby|youth)\b/i.test(productQuery) ? productQuery : `adult ${productQuery}`;
    for (const [index, query] of [`${productQuery} inurl:products`, adultQuery].entries()) {
      signal.throwIfAborted();
      log("search", `“${query}”`);
      let results: SearchResult[];
      try { results = await search(query, index === 1); }
      catch (error) {
        signal.throwIfAborted();
        log("fail", `${piece.name}: ${error instanceof FirecrawlError && error.status === 429 ? "search is busy; try again shortly" : "search could not finish"}`);
        return null;
      }
      const hit = await readCandidates(results, piece, seen);
      if (hit) return hit;
      if (!index) log("retry", `${piece.name}: widening the search`);
    }
    return null;
  };
}
