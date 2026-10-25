import { FirecrawlError, fetchProductPage, searchWeb, type SearchResult } from "../firecrawl/client";
import { htmlToText, parseProduct } from "../products/parse";
import { readShopifyProduct, selectShopifyVariants, shopifySizes } from "../products/shopify";
import { BLOCKED_DOMAINS, NOISE_DOMAINS, isBlockedDomain, isNoiseDomain, registrableDomain } from "./blocklist";
import { SNAPSHOTS } from "../catalog/fallback";
import screenshotHints from "../../data/sourcing/screenshot-hints.json";
import { supportsWearerAudience } from "../custom-looks/audience";
import type { ScreenshotMatch } from "./screenshot-types";
import { reviewScreenshotProducts } from "./screenshot-vision";

export interface ScreenshotPiece { name: string; query: string; alternate?: string; appearance?: string; assembly?: string | null }
export interface ScreenshotProduct { title: string; image: string; url: string; priceCents: number; merchant: string; sizes: string[]; why?: string }
export type SourcingLog = (kind: string, text: string) => void;
type Details = { match: ScreenshotMatch; sizes: string[]; cartReady: boolean };

const EXCLUDED = [...BLOCKED_DOMAINS, ...NOISE_DOMAINS, "alibaba.com", "dhgate.com", "made-in-china.com"];
// Search exclusions reduce noise; the full merchant policy still applies after discovery.
const SEARCH_EXCLUDED = ["amazon.com", "ebay.com", "pinterest.com"];
const SHOPIFY = /\/products\/[^/]+\/?$/i;
const PRODUCT = /\/(listing\/\d+|products?\/|item\/|itm\/|p\/|dp\/|s\/[^/]+\/\d+|shop\/[^/]+\/[^/]+)|[?&](variant|pid|skuId|productId|ID)=|\/-\/A-\d+|\/[\w-]+-p\d+|\.html?$|\/[a-z0-9-]{20,}\/?$/i;
const LISTING = /\/(market|search|c|category|categories|collections|tag|blogs?|articles?|news)(\/|\?|$)/i;
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/);

// Check garment nouns in the merchant title, not a snippet describing related products.
// Specific categories precede broad terms: a dress shirt is a shirt, not a dress.
const KINDS = [
  /\b(boots?|booties)\b/i, /\b(shoes?|heels?|loafers?|sneakers?|pumps?|sandals?)\b/i,
  /\b(headbands?|headpieces?|tiaras?|crowns?|circlets?)\b/i, /\b(hats?|beanies?|berets?|caps?|bonnets?|helmets?)\b/i,
  /\b(wigs?)\b/i, /\b(masks?)\b/i, /\b(wrist[ -]?(?:bands?|straps?|cuffs?)|sweat[ -]?bands?)\b/i, /\b(glasses|sunglasses|spectacles|eyeglasses)\b/i, /\b(goggles)\b/i,
  /\b(collars?)\b/i, /\b(scarf|scarves|neckerchiefs?|bandanas?|wild\s?rags?)\b/i,
  /\b(harness|harnesses|vests?|waistcoats?)\b/i,
  /\b(cardigans?|sweaters?|knitwear|jumpers?)\b/i, /\b(shirts?|blouses?|tops?)\b/i,
  /\b(overalls?|shortalls?|dungarees|pinafores?|rompers?)\b/i,
  /\b(pants?|trousers?|leggings?|jeans|bottoms?|breeches|shorts?)\b/i,
  /\b(catsuits?|unitards?|jumpsuits?)\b/i, /\b(bodysuits?|leotards?)\b/i,
  /\b(wings?)\b/i, /\b(sheets?|ghost costumes?|ghost ponchos?)\b/i, /\b(capes?|cloaks?)\b/i, /\b(jackets?|coats?|blazers?|tunics?)\b/i,
  /\b(skirts?)\b/i, /\b(dresses|dress|gowns?)\b/i, /\b(gloves?|gauntlets?)\b/i,
  /\b(belts?|sashes?)\b/i, /\b(brooch|brooches|pins?)\b/i, /\b(necklaces?|pendants?|chokers?)\b/i,
  /\b(chains?|fobs?|watches|watch)\b/i, /\b(earrings?)\b/i,
  /\b(tights|stockings|socks?)\b/i, /\b(bags?|purses?|satchels?)\b/i,
];
const COLORS = [
  ["black", "ebony"], ["white", "ivory", "cream", "ecru", "oatmeal", "beige"], ["silver", "pewter"], ["gold", "golden"],
  ["red", "burgundy", "maroon", "crimson"], ["blue", "navy", "cobalt"], ["green", "olive", "sage", "emerald"],
  ["purple", "lilac", "lavender", "violet"], ["pink", "rose", "fuchsia"], ["brown", "tan", "beige", "camel"],
  ["yellow", "mustard"], ["orange", "coral"], ["gray", "grey", "charcoal"], ["teal", "turquoise", "aqua"],
];
const wordsMatch = (s: string, words: string[]) => words.some((word) => new RegExp(`\\b${word}\\b`, "i").test(s));
const desiredColors = (piece: ScreenshotPiece) => COLORS.filter((group) => wordsMatch(piece.query, group))
  .sort((a, b) => piece.query.search(new RegExp(`\\b(${a.join("|")})\\b`, "i")) - piece.query.search(new RegExp(`\\b(${b.join("|")})\\b`, "i")))
  // Fine metal frames change tone under scene lighting; dark frame variants still must not pass.
  .map((group) => /\b(glasses|spectacles|eyeglasses)\b/i.test(piece.name)
    && /\b(wire|thin|delicate)\b/i.test(`${piece.name} ${piece.query} ${piece.appearance ?? ""}`)
    && ["gold", "silver"].includes(group[0]) ? ["gold", "golden", "silver", "pewter"] : group);
// The item noun wins: a waistcoat chain is a chain; a ruffled-collar shirt is a shirt.
const kindOf = (piece: ScreenshotPiece) => KINDS.find((kind) => kind.test(tokens(piece.name).at(-1) ?? ""))
  ?? KINDS.find((kind) => kind.test(piece.name)) ?? KINDS.find((kind) => kind.test(piece.query));

const DETAILS = [
  /\b(denim|jeans)\b/i,
  /\b(fox|wolf|canine|animal)\b/i, /\b(ringer|contrast trim|contrast neck)\b/i, /\b(harness|restraint)\b/i,
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
  if (!supportsWearerAudience(text)) return true;
  return [
    /\b\d+\s*(?:[-–]\s*\d+\s*)?(?:years?|months?|yrs?|mos?)\b/i,
    /\b\d+\s*[-–]\s*\d+\s*[my]\b|\b\d+\s*[yt]\b/i,
    /\b(tutorial|download|printable|charm|ornament|keychain|hand fan|yarn|knitting kit|knit kit|sewing kit|knitting pattern|crochet pattern|sewing pattern)\b/i,
    /\b(rent|rental)\b/i,
  ].some((kind) => kind.test(text) && !kind.test(`${piece.name} ${piece.query}`));
}

export function matchesScreenshotPiece(piece: ScreenshotPiece, title: string, details = title): boolean {
  if (wrongAudience(piece, title)) return false;
  if (/\b(glasses|spectacles|eyeglasses)\b/i.test(piece.name) && /\b(goggles)\b/i.test(title)) return false;
  if (/\b(clear|transparent|eyeglasses)\b/i.test(piece.query) && /\b(sunglasses|tinted|opaque)\b/i.test(title)) return false;
  const kind = kindOf(piece);
  if (kind && !kind.test(title) && KINDS.some(other => other.test(title))) return false;
  const noun = tokens(piece.name).at(-1)?.replace(/s$/, "");
  if (kind ? !kind.test(`${title} ${details}`) : !noun || !(tokens(`${title} ${details}`).some(word => word.replace(/s$/, "") === noun) || tokens(piece.query).filter(word => word.length > 3 && tokens(`${title} ${details}`).includes(word)).length >= 2)) return false;
  // Merchant copy can omit color and fine details. Variant selection and photographs still verify them.
  return true;
}

function relevance(piece: ScreenshotPiece, result: SearchResult & { verifiedHint?: boolean }): number {
  const title = tokens(result.title);
  const kind = kindOf(piece);
  return (result.verifiedHint ? 12 : 0) + (result.image ? 3 : 0) + (kind?.test(result.title) ? 20 : 0)
    + DETAILS.filter((detail) => detail.test(piece.query) && detail.test(`${result.title} ${result.description ?? ""}`)).length * 6
    + desiredColors(piece).filter((group) => wordsMatch(result.title, group)).length * 8
    + tokens(piece.query).filter((word) => word.length > 2 && title.includes(word)).length * 2;
}

// Queues share the route's deadline; a busy provider never starts a long retry loop.
let activeSearches = 0;
const waiting: { run: () => void; signal: AbortSignal }[] = [];
async function searchSlot(signal: AbortSignal) {
  signal.throwIfAborted();
  if (activeSearches < 6) { activeSearches++; return; }
  await new Promise<void>((resolve, reject) => {
    const abort = () => { const i = waiting.indexOf(entry); if (i >= 0) waiting.splice(i, 1); reject(signal.reason); };
    const entry = { signal, run: () => { signal.removeEventListener("abort", abort); activeSearches++; resolve(); } };
    waiting.push(entry);
    signal.addEventListener("abort", abort, { once: true });
  });
}
function releaseSearch() {
  activeSearches--;
  let next;
  while ((next = waiting.shift())) if (!next.signal.aborted) { next.run(); break; }
}
function publicUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !allowedHost(url.hostname)
      || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || /\.(local|internal|localhost)$/i.test(url.hostname)) return null;
    url.hash = "";
    return url;
  } catch { return null; }
}
const noteFor = (piece: ScreenshotPiece) => piece.assembly ? `DIY: ${piece.assembly}` : "Similar style. Colors and details may differ.";
const matchFor = (result: SearchResult, piece: ScreenshotPiece): ScreenshotMatch => ({
  title: result.title, url: result.url, merchant: registrableDomain(result.url)!, image: result.image && publicUrl(result.image) ? result.image : null, priceCents: null, currency: null,
  availability: "unknown", kind: LISTING.test(new URL(result.url).pathname) ? "browse" : "product", note: noteFor(piece),
});

export function screenshotSourcing(signal: AbortSignal, log: SourcingLog, reference: Buffer) {
  const searches = new Map<string, Promise<SearchResult[]>>();
  const currencies = new Map<string, Promise<string | null>>();
  function search(query: string) {
    let pending = searches.get(query);
    if (!pending) {
      pending = (async () => {
        await searchSlot(signal);
        try {
          log("search", `“${query}”`);
          return await searchWeb(query, { cache: false, limit: 10, timeoutMs: 6_000, signal,
            excludeDomains: SEARCH_EXCLUDED, highlights: false, images: true });
        } finally { releaseSearch(); }
      })();
      searches.set(query, pending);
    }
    return pending;
  }
  function currency(origin: string, readSignal: AbortSignal) {
    let pending = currencies.get(origin);
    if (!pending) {
      pending = fetch(`${origin}/cart.js?currency=USD`, { cache: "no-store", redirect: "error",
        signal: AbortSignal.any([readSignal, AbortSignal.timeout(2_000)]), headers: { Accept: "application/json" } })
        .then(async response => response.ok ? (await response.json() as { currency?: string }).currency ?? null : null).catch(() => null);
      currencies.set(origin, pending);
    }
    return pending;
  }
  async function read(result: SearchResult, piece: ScreenshotPiece): Promise<Details | null> {
    const readSignal = AbortSignal.any([signal, AbortSignal.timeout(4_000)]);
    const url = publicUrl(result.url);
    if (!url) return null;
    if (SHOPIFY.test(url.pathname)) {
      const pageCurrency = fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.any([readSignal, AbortSignal.timeout(2_500)]) })
        .then(async response => response.ok ? parseProduct((await response.text()).slice(0, 2_000_000), url.toString()).currency : null).catch(() => null);
      const [raw, money, declared] = await Promise.all([
        readShopifyProduct(url.toString(), false, { signal: readSignal, timeoutMs: 2_500 }), currency(url.origin, readSignal), pageCurrency,
      ]);
      if (raw?.title && matchesScreenshotPiece(piece, raw.title, htmlToText(raw.description ?? ""))) {
        const colors = desiredColors(piece);
        const color = colors[0] && raw.variants.flatMap(variant => [variant.option1, variant.option2, variant.option3]).find(value => value && wordsMatch(value, colors[0]));
        const variant = selectShopifyVariants(raw, color ?? undefined)[0];
        const image = [variant?.featured_image?.src, ...raw.images].find(value => typeof value === "string" && /^(https:)?\/\//.test(value))?.replace(/^\/\//, "https://") ?? null;
        if (variant) { url.search = ""; url.searchParams.set("variant", String(variant.id)); url.searchParams.set("currency", "USD"); }
        const sizes = variant ? shopifySizes(raw, variant) : [];
        const price = variant && Number.isSafeInteger(variant.price) && variant.price > 0 ? variant.price : null;
        return { match: { ...matchFor(result, piece), title: raw.title, url: url.toString(), image,
          priceCents: money && money === declared ? price : null, currency: money === declared ? money : null, availability: variant ? "in_stock" : "out_of_stock" },
          sizes, cartReady: !!(image && price && money === "USD" && declared === "USD" && variant) };
      }
    }
    try {
      const page = await fetchProductPage(url.toString(), { cache: false, timeoutMs: 3_500, signal: readSignal });
      if (!publicUrl(page.finalUrl)) return null;
      const product = parseProduct(page.html, page.finalUrl);
      if (!product.title || !matchesScreenshotPiece(piece, product.title, product.description ?? product.title)) return null;
      const image = product.images.find(src => src.startsWith("https://")) ?? null;
      const kind = LISTING.test(new URL(page.finalUrl).pathname) ? "browse" : "product";
      return { match: { ...matchFor(result, piece), title: product.title, url: page.finalUrl, merchant: registrableDomain(page.finalUrl)!,
        image, priceCents: product.currency ? product.priceCents : null, currency: product.currency, availability: product.availability, kind },
        sizes: product.sizes, cartReady: !!(kind === "product" && image && product.priceCents && product.priceCents > 0 && product.currency === "USD" && product.availability !== "out_of_stock") };
    } catch { return null; }
  }
  function shortlist(results: SearchResult[], piece: ScreenshotPiece) {
    const seen = new Set<string>();
    return results.filter(result => {
      const url = publicUrl(result.url);
      if (!url || seen.has(url.toString()) || /\.(gov|mil|edu)$/i.test(url.hostname)
        || /\/(blogs?|articles?|news|wiki|museum|exhibits?)(\/|$)/i.test(url.pathname)) return false;
      if (!matchesScreenshotPiece(piece, result.title, result.description ?? result.title)) return false;
      if (!PRODUCT.test(url.pathname + url.search) && !/\b(shop|buy|sale|price|store|costume)\b|\$/i.test(`${result.title} ${result.description ?? ""} ${url.hostname}`)) return false;
      seen.add(url.toString());
      return true;
    }).sort((a, b) => relevance(piece, b) - relevance(piece, a)).slice(0, 3);
  }
  return async (piece: ScreenshotPiece, onMatch: (match: ScreenshotMatch) => void, onOffer: (offer: ScreenshotProduct) => void) => {
    let candidates: SearchResult[] = [];
    for (const query of [...new Set([piece.query, piece.alternate].filter((query): query is string => !!query))]) {
      signal.throwIfAborted();
      try { candidates = shortlist(await search(`${query} buy`), piece); }
      catch (error) {
        signal.throwIfAborted();
        log("search", `${piece.name}: ${error instanceof FirecrawlError && error.status === 429 ? "search is busy" : "search unavailable"}`);
        break;
      }
      if (candidates.length) break;
    }
    if (!candidates.length) {
      const color = desiredColors(piece)[0];
      const hints = [...screenshotHints, ...SNAPSHOTS.flatMap(snapshot => snapshot.products)]
        .filter(hint => matchesScreenshotPiece(piece, hint.title, hint.description) && (!color || wordsMatch(hint.title, color)));
      candidates = shortlist(hints, piece);
    }
    if (!candidates.length) return;
    onMatch(matchFor(candidates[0], piece));
    log("found", `${piece.name}: found a similar item at ${registrableDomain(candidates[0].url)}`);
    let best = 0;
    // Photos and facts are useful immediately, even before the model compares them.
    const readResults = await Promise.allSettled(candidates.map(async result => {
      const details = await read(result, piece);
      if (!details || signal.aborted) return null;
      const { match } = details;
      const quality = (match.image ? 4 : 0) + (match.priceCents ? 2 : 0) + (match.availability === "in_stock" ? 1 : 0);
      if (quality > best) { best = quality; onMatch(match); }
      return details;
    }));
    const details = readResults.flatMap(result => result.status === "fulfilled" && result.value?.match.image ? [result.value] : []);
    if (!details.length || signal.aborted) return;
    log("review", `${piece.name}: quick product-photo check`);
    try {
      const verdict = await reviewScreenshotProducts(reference, piece, details.map(detail => detail.match), AbortSignal.any([signal, AbortSignal.timeout(7_000)]));
      if (!verdict || signal.aborted) return;
      const selected = details[verdict.index];
      if (!selected) {
        onMatch({ ...details[0].match, note: "May differ from the screenshot. Check the product photos at the shop." });
        return;
      }
      const { match, sizes, cartReady } = selected;
      const note = `${piece.assembly ? `DIY: ${piece.assembly} ` : ""}${verdict.note}`;
      onMatch({ ...match, note });
      if (cartReady && match.image && match.priceCents) onOffer({ title: match.title, url: match.url, image: match.image, priceCents: match.priceCents, merchant: match.merchant, sizes, why: note });
    } catch {
      // A slow or unavailable photo check keeps the discovered shop link on the board.
    }
  };
}
