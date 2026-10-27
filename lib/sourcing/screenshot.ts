import { fetchProductPage, type SearchResult } from "../firecrawl/client";
import { discoverScreenshotWeb } from "./discovery";
import { htmlToText, parseProduct } from "../products/parse";
import { readShopifyProduct, selectShopifyVariants, shopifySizes } from "../products/shopify";
import { BLOCKED_DOMAINS, NOISE_DOMAINS, isBlockedDomain, isNoiseDomain, registrableDomain } from "./blocklist";
import { SNAPSHOTS } from "../catalog/fallback";
import screenshotHints from "../../data/sourcing/screenshot-hints.json";
import { supportsWearerAudience } from "../custom-looks/audience";
import type { ScreenshotMatch } from "./screenshot-types";
import { offerImage, reviewScreenshotProducts } from "./screenshot-vision";
import { decideNext, match as matchCandidates, type MatchResult, type TraceStep, type VisionPiece } from "./vision-client";

export interface ScreenshotPiece { name: string; query: string; alternate?: string; appearance?: string; assembly?: string | null }
export interface ScreenshotProduct { title: string; image: string; url: string; priceCents: number; merchant: string; sizes: string[]; why?: string }
export type SourcingLog = (kind: string, text: string) => void;
type Details = { match: ScreenshotMatch; sizes: string[]; cartReady: boolean };
export interface AgentHooks {
  deadline: number;
  trace: (piece: number, step: TraceStep, detail: Record<string, unknown>) => void;
  onMatch: (match: ScreenshotMatch | null) => void;
  onOffer: (offer: ScreenshotProduct) => void;
  onApproval: (offer: ScreenshotProduct, because: string) => void;
}

const EXCLUDED = [...BLOCKED_DOMAINS, ...NOISE_DOMAINS, "alibaba.com", "dhgate.com", "made-in-china.com",
  "alamy.com", "dreamstime.com", "gettyimages.com", "shutterstock.com", "depositphotos.com", "istockphoto.com"];
// Search exclusions reduce noise; the full merchant policy still applies after discovery.
const SEARCH_EXCLUDED = ["ebay.com", "pinterest.com"];
const SHOPIFY = /\/products\/[^/]+\/?$/i;
const PRODUCT = /\/(listing\/\d+|products?\/|item\/|itm\/|p\/|dp\/|s\/[^/]+\/\d+|shop\/[^/]+\/[^/]+)|[?&](variant|pid|skuId|productId|ID)=|\/-\/A-\d+|\/[\w-]+-p\d+|\.html?$|\/[a-z0-9-]{20,}\/?$/i;
const LISTING = /\/(market|search|c|category|categories|collections|tag|blogs?|articles?|news)(\/|\?|$)/i;
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/);

// Check garment nouns in the merchant title, not a snippet describing related products.
// Specific categories precede broad terms: a dress shirt is a shirt, not a dress.
const KINDS = [
  /\b(boots?|booties|cleats?)\b/i, /\b(shoes?|heels?|loafers?|sneakers?|pumps?|sandals?)\b/i,
  /\b(headbands?|headpieces?|tiaras?|crowns?|circlets?)\b/i, /\b(hats?|beanies?|berets?|caps?|bonnets?|helmets?|fedoras?|trilb(?:y|ies))\b/i,
  /\b(wigs?)\b/i, /\b(masks?)\b/i, /\b(wrist[ -]?(?:bands?|straps?|cuffs?)|sweat[ -]?bands?)\b/i, /\b(glasses|sunglasses|spectacles|eyeglasses)\b/i, /\b(goggles)\b/i,
  /\b(collars?)\b/i, /\b(scarf|scarves|neckerchiefs?|bandanas?|wild\s?rags?)\b/i,
  /\b(harness|harnesses|vests?|waistcoats?)\b/i,
  /\b(cardigans?|sweaters?|knitwear|jumpers?)\b/i, /\b(shirts?|jerseys?|blouses?|tops?)\b/i,
  /\b(overalls?|shortalls?|dungarees|pinafores?|rompers?)\b/i,
  /\b(pants?|trousers?|leggings?|jeans|bottoms?|breeches|shorts?)\b/i,
  /\b(catsuits?|unitards?|jumpsuits?)\b/i, /\b(bodysuits?|leotards?)\b/i,
  /\b(wings?)\b/i, /\b(sheets?|ghost costumes?|ghost ponchos?)\b/i, /\b(capes?|cloaks?)\b/i, /\b(jackets?|coats?|blazers?|tunics?)\b/i,
  /\b(skirts?)\b/i, /\b(dresses|dress|gowns?)\b/i, /\b(gloves?|gauntlets?)\b/i,
  /\b(belts?|cross[ -]?belts?|sashes?)\b/i, /\b(medals?|decorations?|ribbon (?:bars?|racks?))\b/i, /\b(brooch|brooches|pins?)\b/i, /\b(necklaces?|pendants?|chokers?)\b/i,
  /\b(chains?|fobs?|watches|watch)\b/i, /\b(earrings?)\b/i,
  /\b(tights|stockings|socks?)\b/i, /\b(bags?|purses?|satchels?)\b/i,
  /\b(straps?)\b/i,
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
const hornedHeadwear = (piece: ScreenshotPiece) => /\b(horns?|horned|viking)\b/i.test(`${piece.name} ${piece.query}`)
  && /\b(headbands?|headpieces?|helmets?|hats?|crowns?)\b/i.test(`${piece.name} ${piece.query}`);
const kindOf = (piece: ScreenshotPiece) => hornedHeadwear(piece) ? /\b(headbands?|headpieces?|helmets?|hats?|horns?)\b/i : KINDS.find((kind) => kind.test(tokens(piece.name).at(-1) ?? ""))
  ?? KINDS.find((kind) => kind.test(piece.name)) ?? KINDS.find((kind) => kind.test(piece.query));

const DETAILS = [
  /\b(fedora|trilby)\b/i, /\b(bomber|flight|aviator)\b/i, /\b(solid|plain)\b/i,
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
/** Titles can hide a kids' cut that only the size list reveals. No adult size left means no adult product. */
function adultSizes(piece: ScreenshotPiece, sizes: string[]) {
  const forChild = (size: string) => CHILD_SIZE.some(kind => kind.test(size)) || /\b(kids?|youth|toddler|infant|baby|child(?:ren)?)\b/i.test(size);
  if (forChild(`${piece.name} ${piece.query}`)) return sizes;
  const adult = sizes.filter(size => !forChild(size));
  return sizes.length && !adult.length ? null : adult;
}
const allowedHost = (host: string) => !isBlockedDomain(host) && !isNoiseDomain(host) && !EXCLUDED.some((domain) => host === domain || host.endsWith(`.${domain}`));
const CHILD_SIZE = [/\b\d+\s*(?:[-–]\s*\d+\s*)?(?:years?|months?|yrs?|mos?)\b/i, /\b\d+\s*[-–]\s*\d+\s*[my]\b|\b\d+\s*[yt]\b/i];
function wrongAudience(piece: ScreenshotPiece, text: string) {
  if (!supportsWearerAudience(text)) return true;
  return [
    ...CHILD_SIZE,
    /\b(tutorial|download|printable|charm|ornament|keychain|hand fan|yarn|knitting kit|knit kit|sewing kit|knitting pattern|crochet pattern|sewing pattern)\b/i,
    /\b(rent|rental)\b/i,
  ].some((kind) => kind.test(text) && !kind.test(`${piece.name} ${piece.query}`));
}

export function matchesScreenshotPiece(piece: ScreenshotPiece, title: string, details = title): boolean {
  if (wrongAudience(piece, title)) return false;
  if (/\b(glasses|spectacles|eyeglasses)\b/i.test(piece.name) && /\b(goggles)\b/i.test(title)) return false;
  if (/\b(clear|transparent|eyeglasses)\b/i.test(piece.query) && /\b(sunglasses|tinted|opaque)\b/i.test(title)) return false;
  const wanted = `${piece.name} ${piece.query}`;
  const tee = /\b(t[ -]?shirts?|tees?)\b/i;
  const buttonShirt = /\b(dress shirt|button[ -]?(?:front|up|down)?(?: shirt)?|polo|henley)\b/i;
  if (tee.test(wanted) && buttonShirt.test(title) && !tee.test(title)) return false;
  if (buttonShirt.test(wanted) && tee.test(title) && !buttonShirt.test(title)) return false;
  if (hornedHeadwear(piece) && !/\b(horns?|horned|viking|devil|demon)\b/i.test(title)) return false;
  if (/\bshorts\b/i.test(wanted) && /\b(pants|trousers|jeans|leggings)\b/i.test(title) && !/\bshorts\b/i.test(title)) return false;
  if (hornedHeadwear(piece) && !/\bunicorn\b/i.test(wanted) && /\bunicorn\b/i.test(title)) return false;
  if (/\b(solid|plain)\b/i.test(wanted) && /\b(plaid|striped|floral)\b/i.test(title) && !/\b(plaid|striped|floral)\b/i.test(wanted)) return false;
  if (/\b(fedora|trilby)\b/i.test(wanted) && /\b(bucket|baseball|beanie|sunhat)\b/i.test(title)) return false;
  if (/\b(flight|bomber)\b/i.test(wanted) && /\b(biker|motorcycle|racer)\b/i.test(title) && !/\b(flight|bomber|aviator)\b/i.test(title)) return false;
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
  // Shopify product URLs usually read straight to a cart-ready price; other shops often need a slow browser scrape.
  return (result.verifiedHint ? 12 : 0) + (result.image ? 3 : 0) + (SHOPIFY.test(urlPath(result.url)) ? 5 : 0) + (kind?.test(result.title) ? 20 : 0)
    + DETAILS.filter((detail) => detail.test(piece.query) && detail.test(`${result.title} ${result.description ?? ""}`)).length * 6
    + desiredColors(piece).filter((group) => wordsMatch(result.title, group)).length * 8
    + tokens(piece.query).filter((word) => word.length > 2 && title.includes(word)).length * 2;
}

const urlPath = (value: string) => { try { return new URL(value).pathname; } catch { return ""; } };
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

// A shop's cart currency is stable, so later screenshots skip this round trip. Failures are retried.
const currencies = new Map<string, Promise<string | null>>();

export function screenshotSourcing(signal: AbortSignal, log: SourcingLog, reference: Buffer) {
  const searches = new Map<string, Promise<SearchResult[]>>();
  let backupReported = false;
  function search(query: string) {
    let pending = searches.get(query);
    if (!pending) {
      log("search", `“${query}”`);
      pending = discoverScreenshotWeb(query, { signal, limit: 10, timeoutMs: 4_000,
        excludeDomains: SEARCH_EXCLUDED, highlights: false, images: true,
        log: (kind, text) => { if (!backupReported) { backupReported = true; log(kind, text); } } });
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
      void pending.then(value => { if (!value) currencies.delete(origin); });
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
        const colorIndex = raw.options.findIndex(option => /colou?r/i.test(typeof option === "string" ? option : option.name));
        const enforceColor = !hornedHeadwear(piece) && colorIndex >= 0 && colors.length > 0;
        const color = enforceColor ? raw.variants.filter(variant => variant.available)
          .map(variant => [variant.option1, variant.option2, variant.option3][colorIndex] ?? variant.options?.[colorIndex])
          .find(value => value && wordsMatch(value, colors[0])) : undefined;
        // A truncated merchant feed may omit the requested color. Never silently buy its default color.
        if (enforceColor && !color) return null;
        const variant = selectShopifyVariants(raw, typeof color === "string" ? color : undefined)[0];
        const image = [variant?.featured_image?.src, ...raw.images].find(value => typeof value === "string" && /^(https:)?\/\//.test(value))?.replace(/^\/\//, "https://") ?? null;
        if (variant) { url.search = ""; url.searchParams.set("variant", String(variant.id)); url.searchParams.set("currency", "USD"); }
        const sizes = adultSizes(piece, variant ? shopifySizes(raw, variant) : []);
        if (!sizes) return null;
        const price = variant && Number.isSafeInteger(variant.price) && variant.price > 0 ? variant.price : null;
        return { match: { ...matchFor(result, piece), title: raw.title, url: url.toString(), image,
          priceCents: money && money === declared ? price : null, currency: money === declared ? money : null, availability: variant ? "in_stock" : "out_of_stock" },
          sizes, cartReady: !!(image && price && money === "USD" && declared === "USD" && variant) };
      }
    }
    try {
      let page: Awaited<ReturnType<typeof fetchProductPage>>;
      try {
        // Most shops already expose product facts in public HTML. Reserve browser jobs for the rest.
        const response = await fetch(url, { cache: "no-store", redirect: "error", headers: { Accept: "text/html" },
          signal: AbortSignal.any([readSignal, AbortSignal.timeout(2_000)]) });
        if (!response.ok) throw new Error("Merchant HTML unavailable");
        const html = (await response.text()).slice(0, 2_000_000);
        const facts = parseProduct(html, url.toString());
        if (!facts.title || !facts.priceCents || !facts.images.length) throw new Error("Rendered facts needed");
        page = { url: url.toString(), finalUrl: url.toString(), status: response.status, html };
      } catch { page = await fetchProductPage(url.toString(), { cache: false, timeoutMs: 3_500, signal: readSignal }); }
      if (!publicUrl(page.finalUrl) || registrableDomain(page.finalUrl) !== registrableDomain(url.toString())) return null;
      const product = parseProduct(page.html, page.finalUrl);
      if (!product.title || !matchesScreenshotPiece(piece, product.title, product.description ?? product.title)) return null;
      const sizes = adultSizes(piece, product.sizes);
      if (!sizes) return null;
      const image = product.images.find(src => src.startsWith("https://")) ?? null;
      const kind = LISTING.test(new URL(page.finalUrl).pathname) ? "browse" : "product";
      return { match: { ...matchFor(result, piece), title: product.title, url: page.finalUrl, merchant: registrableDomain(page.finalUrl)!,
        image, priceCents: product.currency ? product.priceCents : null, currency: product.currency, availability: product.availability, kind },
        sizes, cartReady: !!(kind === "product" && image && product.priceCents && product.priceCents > 0 && product.currency === "USD" && product.availability === "in_stock") };
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
  async function discover(piece: ScreenshotPiece, queries: string[], hints: boolean) {
    for (const query of [...new Set(queries.filter(Boolean))]) {
      signal.throwIfAborted();
      try {
        const candidates = shortlist(await search(`${query} buy`), piece);
        if (candidates.length) return candidates;
      } catch {
        signal.throwIfAborted();
        log("search", `${piece.name}: live search is temporarily unavailable`);
        break;
      }
    }
    if (!hints) return [];
    const color = desiredColors(piece)[0];
    return shortlist([...screenshotHints, ...SNAPSHOTS.flatMap(snapshot => snapshot.products)]
      .filter(hint => matchesScreenshotPiece(piece, hint.title, hint.description) && (!color || wordsMatch(hint.title, color))), piece);
  }
  async function readAll(candidates: SearchResult[], piece: ScreenshotPiece, onMatch: (match: ScreenshotMatch | null) => void): Promise<Details[]> {
    let best = 0;
    // Photos and facts are useful immediately, even before anything compares them.
    const readResults = await Promise.allSettled(candidates.map(async result => {
      const details = await read(result, piece);
      if (!details || signal.aborted) return null;
      const { match } = details;
      const quality = (match.image ? 4 : 0) + (match.priceCents ? 2 : 0) + (match.availability === "in_stock" ? 1 : 0);
      if (quality > best) { best = quality; onMatch(match); }
      return details;
    }));
    return readResults.flatMap(result => result.status === "fulfilled" && result.value?.match.image ? [result.value] : []);
  }
  const offerFor = ({ match, sizes }: Details, why: string): ScreenshotProduct =>
    ({ title: match.title, url: match.url, image: match.image!, priceCents: match.priceCents!, merchant: match.merchant, sizes, why });

  /** Perceive → search → score → decide. Retries change one thing about the query; uncertain picks wait for the shopper. */
  async function agent(piece: ScreenshotPiece, seen: VisionPiece, index: number, hooks: AgentHooks) {
    const tried = new Set<string>();
    let query = piece.query;
    let current = piece;
    let best: { result: MatchResult; details: Details } | null = null;
    let shown = false;
    for (let attempt = 0; ; attempt++) {
      tried.add(query.toLowerCase());
      const t0 = performance.now();
      const candidates = await discover(current, attempt ? [query] : [query, piece.alternate ?? ""], attempt === 0);
      hooks.trace(index, "search", { attempt, query, candidates: candidates.length, ms: Math.round(performance.now() - t0) });
      if (candidates.length && !shown) { shown = true; hooks.onMatch(matchFor(candidates[0], current)); }
      const details: Details[] = candidates.length ? await readAll(candidates, current, best || attempt ? () => {} : hooks.onMatch) : [];
      signal.throwIfAborted();
      const photos = (await Promise.all(details.map(async (d, i) => {
        try { return { id: String(i), image: await offerImage(d.match.image!, signal) }; } catch { return null; }
      }))).filter(photo => photo !== null);
      let results: MatchResult[] = [];
      try {
        if (photos.length) results = (await matchCandidates(seen, photos, AbortSignal.any([signal, AbortSignal.timeout(Math.max(1_000, hooks.deadline - performance.now() - 2_000))]))).results;
      } catch (error) {
        signal.throwIfAborted();
        // Scoring is a supplement: without it (or once it would end within 2 s of the deadline), the shopper confirms the first cart-ready find.
        console.warn(JSON.stringify({ event: "screenshot_opencv_miss", step: "match", error: String(error) }));
        hooks.trace(index, "score", { attempt, results: [], error: "opencv_unavailable" });
        hooks.trace(index, "decide", { attempt, action: "approve", because: "opencv_unavailable", best_score: null });
        const ready = details.find(d => d.cartReady && d.match.image && d.match.priceCents);
        if (ready) hooks.onApproval(offerFor(ready, "OpenCV scoring was unavailable. Check the photo before adding it."), "opencv_unavailable");
        return;
      }
      hooks.trace(index, "score", { attempt, results: results.map(r => ({
        title: details[Number(r.id)].match.title, merchant: details[Number(r.id)].match.merchant, score: r.score, verdict: r.verdict,
        reasons: r.reasons, embedding: r.embedding_similarity, delta_e: r.color_delta_e, color: r.candidate_color, foreground: r.foreground,
      })) });
      for (const result of results) {
        if (result.verdict !== "reject" && (!best || result.score > best.result.score)) best = { result, details: details[Number(result.id)] };
      }
      const decision = decideNext(seen, results, attempt, hooks.deadline - performance.now(), tried);
      hooks.trace(index, "decide", decision.action === "retry" ? { attempt, action: "retry", because: decision.because, next: decision.query }
        : { attempt, action: decision.action, because: decision.action === "approve" ? decision.because : "match", best_score: best?.result.score ?? null });
      if (decision.action === "retry") {
        query = decision.query;
        // The shop-title filters read the query, so the retried garment type or color applies to them too.
        current = { ...piece, query, alternate: undefined, name: decision.because === "type_mismatch" ? query : piece.name };
        log("retry", `${piece.name}: ${decision.because.replace("_", " ")}, trying "${query}"`);
        continue;
      }
      if (!best) { hooks.onMatch(null); return; }
      const { match, cartReady } = best.details;
      const scored = `Matched by OpenCV: ${best.result.candidate_color.name}, score ${best.result.score.toFixed(2)}.`;
      const note = `${piece.assembly ? `DIY: ${piece.assembly} ` : ""}${scored}`;
      hooks.onMatch({ ...match, note });
      if (!cartReady || !match.image || !match.priceCents) return;
      if (decision.action === "accept") hooks.onOffer(offerFor(best.details, note));
      else {
        hooks.trace(index, "approve", { because: decision.because, score: best.result.score, title: match.title });
        hooks.onApproval(offerFor(best.details, note), decision.because);
      }
      return;
    }
  }

  return async (piece: ScreenshotPiece, onMatch: (match: ScreenshotMatch | null) => void, onOffer: (offer: ScreenshotProduct) => void, vision?: { seen: VisionPiece; index: number } & Omit<AgentHooks, "onMatch" | "onOffer">) => {
    if (vision) return agent(piece, vision.seen, vision.index, { ...vision, onMatch, onOffer });
    const candidates = await discover(piece, [piece.query, piece.alternate ?? ""], true);
    if (!candidates.length) return;
    onMatch(matchFor(candidates[0], piece));
    log("found", `${piece.name}: found a similar item at ${registrableDomain(candidates[0].url)}`);
    const details = await readAll(candidates, piece, onMatch);
    if (!details.length || signal.aborted) return;
    log("review", `${piece.name}: quick product-photo check`);
    try {
      const verdict = await reviewScreenshotProducts(reference, piece, details.map(detail => detail.match), AbortSignal.any([signal, AbortSignal.timeout(7_000)]));
      if (!verdict || signal.aborted) return;
      const selected = details[verdict.index];
      if (!selected) {
        onMatch(null);
        return;
      }
      const note = `${piece.assembly ? `DIY: ${piece.assembly} ` : ""}${verdict.note}`;
      onMatch({ ...selected.match, note });
      if (selected.cartReady && selected.match.image && selected.match.priceCents) onOffer(offerFor(selected, note));
    } catch {
      // A slow or unavailable photo check keeps the discovered shop link on the board.
    }
  };
}
