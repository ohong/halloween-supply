import { createHash } from "node:crypto";
import { fetchProductPage, searchWeb } from "../firecrawl/client";
import { htmlToText, parseProduct } from "../products/parse";
import { readShopifyProduct, selectShopifyVariants, shopifySizes } from "../products/shopify";
import { hostnameOf, isBlockedDomain, isNoiseDomain, registrableDomain } from "../sourcing/blocklist";
import type { CartItem } from "../types";
import type { CustomPiece } from "./types";
import { chooseRelevantProduct } from "./relevance";
import { supportsWearerAudience, type WearerAudience } from "./audience";

type Look = { pieces: CustomPiece[] };

// Search results are only worth scraping when the URL looks like one product.
const PRODUCT_PATH = /\/(listing|listings|products?|item|itm|p|dp|shop\/[^/]+\/[^/]+)\/|[?&](variant|pid)=|\/[\w-]+-p\d+|\.html?$/i;
const LISTING_PATH = /\/(market|search|c|category|categories|collections\/[^/]+\/?$|tag|shop\/?$)(\/|\?|$)/i;
const WHOLESALE = /(^|\.)(alibaba|dhgate|made-in-china)\.com$/;

export type Found = { title: string; image: string; url: string; priceCents: number; merchant: string; sizes: string[]; description?: string; variant?: string };
export type SourceLog = (kind: string, text: string) => void;
type SourceOptions = { strictRelevance?: boolean; audience?: WearerAudience };

const SHOPIFY_PATH = /\/products\/[^/]+\/?$/;

// Firecrawl allows ~30 searches a minute per account, so every request shares three slots,
// repeats of a query reuse one result, and a rate-limited search waits for the window to reopen.
let searching = 0;
const waiting: (() => void)[] = [];
const searches = new Map<string, Promise<Awaited<ReturnType<typeof searchWeb>>>>();
async function searchOnce(query: string) {
  while (searching >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
  searching++;
  try {
    for (const wait of [3_000, 8_000, 0]) {
      try { return await searchWeb(query, { cache: true, timeoutMs: 10_000 }); }
      catch (error) {
        if (!wait || !(error instanceof Error && /HTTP 429/.test(error.message))) throw error;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    throw new Error("unreachable");
  } finally {
    searching--;
    waiting.shift()?.();
  }
}
function search(query: string) {
  let pending = searches.get(query);
  if (!pending) {
    pending = searchOnce(query);
    pending.catch(() => searches.delete(query));
    if (searches.size >= 500) searches.delete(searches.keys().next().value!);
    searches.set(query, pending);
  }
  return pending;
}

const COLORS = /\b(black|white|ivory|cream|beige|tan|brown|red|burgundy|maroon|pink|purple|lilac|lavender|violet|blue|navy|teal|turquoise|aqua|green|olive|sage|mint|yellow|mustard|gold|silver|orange|coral|gr[ae]y)\b/i;

/** Shopify's public product JSON answers in ~300 ms, so most pieces never need a full scrape. */
async function readShopify(url: string, color: string | undefined): Promise<Found | null> {
  const origin = new URL(url).origin;
  const [product, currency] = await Promise.all([
    readShopifyProduct(url, true),
    // Checkout charges only USD presentment, so drop overseas shops now rather than at payment.
    fetch(`${origin}/cart.js`, { signal: AbortSignal.timeout(5_000), headers: { Accept: "application/json" } })
      .then((response) => response.ok ? response.json() as Promise<{ currency?: string }> : null)
      .then((cart) => cart?.currency ?? null).catch(() => null),
  ]);
  if (!product || currency !== "USD") return null;
  // A green skirt query must not sell a black skirt: take the color variant, or a title that names the color.
  // Merchants name colors loosely ("Sage Green"), so match the color word inside the option label.
  const named = color ? new RegExp(`\\b${color}\\b`, "i") : null;
  const label = named && product.variants.flatMap((v) => [v.option1, v.option2, v.option3]).find((option) => option && named.test(option));
  const variant = !named ? selectShopifyVariants(product)[0]
    : label ? selectShopifyVariants(product, label)[0]
    : named.test(product.title ?? "") ? selectShopifyVariants(product)[0] : undefined;
  const image = [variant?.featured_image?.src, ...product.images].find(Boolean)?.replace(/^\/\//, "https://");
  if (!variant || !image?.startsWith("https://") || !product.title) return null;
  const productUrl = new URL(url);
  productUrl.search = "";
  productUrl.searchParams.set("variant", String(variant.id));
  const host = productUrl.hostname;
  return { title: product.title, image, url: productUrl.toString(), priceCents: variant.price, merchant: registrableDomain(host) ?? host,
    sizes: shopifySizes(product, variant), description: htmlToText(product.description ?? "").slice(0, 1800), variant: variant.title };
}

async function scrape(url: string, color: string | undefined): Promise<Found | null> {
  try {
    const page = await fetchProductPage(url, { cache: true, timeoutMs: 9_000 });
    const product = parseProduct(page.html, page.finalUrl);
    const image = product.images.find((src) => /^https:\/\//.test(src));
    if (color && !new RegExp(`\\b${color}\\b`, "i").test(product.title ?? "")) return null;
    if (!product.title || !product.priceCents || product.priceCents <= 0 || product.currency !== "USD" || !image || product.availability === "out_of_stock") return null;
    const finalUrl = /^https:\/\//.test(page.finalUrl) ? page.finalUrl : url;
    const host = hostnameOf(finalUrl);
    if (!host || isBlockedDomain(host) || isNoiseDomain(host)) return null;
    return { title: product.title, image, url: finalUrl, priceCents: product.priceCents, merchant: registrableDomain(host) ?? host,
      sizes: product.sizes, description: product.description?.slice(0, 1800) };
  } catch {
    return null;
  }
}

/** Search, read up to five Shopify candidates in parallel, and scrape one other shop only as a fallback. */
async function source(piece: CustomPiece, log: SourceLog, broad: boolean, signal?: AbortSignal, options: SourceOptions = {}): Promise<Found | null> {
  signal?.throwIfAborted();
  const query = broad ? piece.query : `${piece.query} inurl:products`;
  log("search", `“${query}”`);
  let results: Awaited<ReturnType<typeof searchWeb>>;
  try { results = await search(query); }
  catch (error) {
    if (options.strictRelevance) console.warn("[custom-look-source] search_failed", { pass: broad ? "broad" : "filtered", errorClass: error instanceof Error ? error.name : "UnknownError" });
    log("fail", `${piece.name}: ${error instanceof Error && /HTTP 429/.test(error.message) ? "search is busy" : "search failed"}`);
    return null;
  }
  signal?.throwIfAborted();
  const shopify: string[] = [];
  const others: string[] = [];
  const seenHosts = new Set<string>();
  for (const result of results) {
    const host = hostnameOf(result.url);
    if (!host || !result.url.startsWith("https://") || seenHosts.has(host)) continue;
    seenHosts.add(host);
    if (isBlockedDomain(host) || WHOLESALE.test(host)) { log("blocked", host); continue; }
    if (isNoiseDomain(host)) { log("skip", `${host}: not a shop`); continue; }
    const { pathname, search: query } = new URL(result.url);
    if (SHOPIFY_PATH.test(pathname)) { if (shopify.length < 5) { shopify.push(result.url); log("candidate", host); } }
    else if (!LISTING_PATH.test(pathname + query) && PRODUCT_PATH.test(pathname + query) && others.length < 1) others.push(result.url);
  }
  const color = COLORS.exec(piece.query)?.[1]?.toLowerCase();
  const reads = await Promise.all(shopify.map((url) => readShopify(url, color)));
  signal?.throwIfAborted();
  if (options.strictRelevance) {
    const candidates = reads.filter((read): read is Found => read !== null);
    if (others.length) {
      const fallback = await scrape(others[0], color);
      if (fallback && !candidates.some((candidate) => candidate.url === fallback.url)) candidates.push(fallback);
    }
    signal?.throwIfAborted();
    const suitable = candidates.filter((candidate) => supportsWearerAudience(candidate.title, options.audience));
    if (suitable.length !== candidates.length) console.info("[custom-look-source] audience_rejected", { pass: broad ? "broad" : "filtered", candidates: candidates.length - suitable.length });
    let selected: Found | null = null;
    if (suitable.length) {
      log("compare", `${piece.name}: checking ${suitable.length} verified ${suitable.length === 1 ? "offer" : "offers"} against the costume.`);
      try {
        selected = await chooseRelevantProduct(piece, suitable, signal, options.audience);
        if (!selected) {
          console.info("[custom-look-source] relevance_rejected", { pass: broad ? "broad" : "filtered", candidates: suitable.length });
          log("fail", `${piece.name}: no offer supports the identifying costume details.`);
        }
      } catch (error) {
        signal?.throwIfAborted();
        console.warn("[custom-look-source] relevance_unavailable", { pass: broad ? "broad" : "filtered", errorClass: error instanceof Error ? error.name : "UnknownError" });
        log("fail", `${piece.name}: a reliable product match could not be confirmed.`);
      }
    } else {
      console.info("[custom-look-source] no_verified_offers", { pass: broad ? "broad" : "filtered" });
      log("fail", `${piece.name}: no verified offers were available.`);
    }
    if (selected) return selected;
    // One broader pass can recover a real match hidden by the Shopify-only query.
    // The broad flag bounds discovery to two searches; the route owns the overall deadline.
    if (!broad) {
      signal?.throwIfAborted();
      log("search", `${piece.name}: checking more shops…`);
      return source(piece, log, true, signal, options);
    }
    return null;
  }
  // Search order is relevance order, so keep the first shop that can sell the piece.
  const hit = reads.find((read) => read !== null);
  if (hit) return hit;
  if (others.length) return scrape(others[0], color);
  // Only a search that found no shop at all earns a second, broader one: the account allows ~30 a minute.
  return !broad && shopify.length === 0 ? source(piece, log, true, signal, options) : null;
}

export function sourcePiece(piece: CustomPiece, log: SourceLog, signal?: AbortSignal, options: SourceOptions = {}): Promise<Found | null> {
  return source(piece, log, false, signal, options);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "piece";

export function toCartItem(i: number, piece: Look["pieces"][number], found: Found, prefix = "shot"): CartItem {
  return {
    pieceId: `${prefix}-${i}-${slug(piece.name)}`,
    pieceName: piece.name,
    sizeKind: piece.sizeKind,
    productId: createHash("sha256").update(found.url).digest("hex").slice(0, 24),
    title: found.title.slice(0, 200),
    productUrl: found.url,
    image: found.image,
    merchantId: found.merchant,
    merchantName: found.merchant,
    priceCents: found.priceCents,
    availableSizes: [...new Set(found.sizes)].slice(0, 100),
    size: null,
  };
}
