import type { Availability } from "../types";
import { parsePriceToCents } from "./price";

export interface ParsedProduct {
  title: string | null;
  priceCents: number | null;
  currency: string | null;
  images: string[];
  availability: Availability;
  sizes: string[];
  description: string | null;
  /** Which strategy produced the fields. */
  via: "json-ld" | "open-graph" | "claude" | "none";
}

// ---------------------------------------------------------------------------
// Small HTML helpers (no dependencies; safe in any runtime).
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-",
  rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: "...", reg: "®", copy: "©", trade: "™",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      } catch {
        return m;
      }
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Visible text of a page: scripts/styles removed, tags stripped, whitespace collapsed. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s"'<>/=]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  // skip the tag name
  const body = tag.replace(/^<\s*[a-z0-9]+/i, "");
  while ((m = re.exec(body))) {
    const k = m[1].toLowerCase();
    if (k === "/") continue;
    if (!(k in out)) out[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

interface MetaEntry {
  key: string;
  content: string;
}

function readMeta(html: string): MetaEntry[] {
  const out: MetaEntry[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const key = (a.property ?? a.name ?? a.itemprop ?? "").toLowerCase();
    const content = a.content;
    if (key && content !== undefined) out.push({ key, content: content.trim() });
  }
  return out;
}

function metaAll(meta: MetaEntry[], ...keys: string[]): string[] {
  return meta.filter((m) => keys.includes(m.key) && m.content).map((m) => m.content);
}

function absolutize(src: string, base: string): string | null {
  try {
    const u = new URL(src, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function pushUnique(list: string[], value: string | null | undefined) {
  if (value && !list.includes(value)) list.push(value);
}

function cleanText(s: unknown, max = 600): string | null {
  if (typeof s !== "string") return null;
  const t = htmlToText(s);
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

type Json = unknown;
type Node = Record<string, Json>;

const isObj = (v: Json): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);

function typesOf(n: Node): string[] {
  const t = n["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string").map((x) => x.replace(/^.*[/#]/, ""));
}

/** All JSON-LD script payloads, parsed (unparseable blocks are skipped). */
export function readJsonLdBlocks(html: string): Json[] {
  const out: Json[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/(?:ld\+json|json\+ld)["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let text = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, "").trim();
    if (!text) continue;
    for (const attempt of [text, text.replace(/[\u0000-\u001f]+/g, " "), text.replace(/,\s*([}\]])/g, "$1")]) {
      try {
        out.push(JSON.parse(attempt));
        break;
      } catch {
        // try the next cleanup
      }
    }
    text = "";
  }
  return out;
}

interface JsonLdIndex {
  roots: Node[];
  byId: Map<string, Node>;
}

function indexJsonLd(blocks: Json[]): JsonLdIndex {
  const roots: Node[] = [];
  const byId = new Map<string, Node>();
  const collect = (v: Json, depth: number) => {
    if (depth > 8) return;
    if (Array.isArray(v)) {
      for (const x of v) collect(x, depth + 1);
      return;
    }
    if (!isObj(v)) return;
    if (typeof v["@id"] === "string" && typesOf(v).length) byId.set(v["@id"], v);
    for (const val of Object.values(v)) if (typeof val === "object" && val) collect(val, depth + 1);
  };
  const top = (v: Json, depth: number) => {
    if (depth > 8) return;
    if (Array.isArray(v)) {
      for (const x of v) top(x, depth + 1);
      return;
    }
    if (!isObj(v)) return;
    if (v["@graph"]) top(v["@graph"], depth + 1);
    if (typesOf(v).length) roots.push(v);
    // Product nested in WebPage.mainEntity, ItemList items, etc.
    for (const k of ["mainEntity", "mainEntityOfPage", "itemListElement", "item"]) if (v[k]) top(v[k], depth + 1);
  };
  for (const b of blocks) {
    collect(b, 0);
    top(b, 0);
  }
  return { roots, byId };
}

function deref(v: Json, idx: JsonLdIndex): Json {
  if (isObj(v) && typeof v["@id"] === "string" && Object.keys(v).length === 1) return idx.byId.get(v["@id"]) ?? v;
  return v;
}

function asArray(v: Json): Json[] {
  return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
}

function availabilityFrom(v: Json): Availability {
  if (typeof v !== "string") return "unknown";
  const s = v.replace(/^.*[/#]/, "").replace(/[\s_-]/g, "").toLowerCase();
  if (/^(instock|limitedavailability|onlineonly|instoreonly)$/.test(s) || s === "instock") return "in_stock";
  if (/(outofstock|soldout|discontinued|oos)/.test(s)) return "out_of_stock";
  return "unknown";
}

interface OfferFact {
  cents: number;
  currency: string | null;
  availability: Availability;
  size: string | null;
}

function sizeOf(n: Node): string | null {
  const direct = n.size;
  const pick = (v: Json): string | null => {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
    if (isObj(v)) return pick(v.value ?? v.name);
    if (Array.isArray(v)) return pick(v[0]);
    return null;
  };
  const d = pick(direct);
  if (d) return d;
  for (const p of asArray(n.additionalProperty)) {
    if (isObj(p) && typeof p.name === "string" && /^size$/i.test(p.name.trim())) {
      const s = pick(p.value);
      if (s) return s;
    }
  }
  return null;
}

function offerFacts(offersRaw: Json, idx: JsonLdIndex, size: string | null, depth = 0): OfferFact[] {
  if (depth > 3) return [];
  const facts: OfferFact[] = [];
  for (const raw of asArray(offersRaw)) {
    const o = deref(raw, idx);
    if (!isObj(o)) continue;
    const nested = asArray(o.offers).length ? offerFacts(o.offers, idx, size, depth + 1) : [];
    facts.push(...nested);
    const specs = asArray(o.priceSpecification).map((s) => deref(s, idx)).filter(isObj);
    const candidates: Json[] = [o.price, ...specs.map((s) => s.price)];
    if (!nested.length) candidates.push(o.lowPrice);
    let cents: number | null = null;
    for (const c of candidates) {
      cents = parsePriceToCents(c);
      if (cents !== null) break;
    }
    if (cents === null) continue;
    const currency =
      (typeof o.priceCurrency === "string" && o.priceCurrency) ||
      (specs.find((s) => typeof s.priceCurrency === "string")?.priceCurrency as string | undefined) ||
      null;
    facts.push({
      cents,
      currency: currency ? currency.toUpperCase() : null,
      availability: availabilityFrom(o.availability),
      size,
    });
  }
  return facts;
}

function imagesFrom(v: Json, base: string, idx: JsonLdIndex, out: string[]) {
  for (const raw of asArray(v)) {
    const x = deref(raw, idx);
    if (typeof x === "string") pushUnique(out, absolutize(x, base));
    else if (isObj(x)) {
      const u = x.url ?? x.contentUrl ?? x["@id"];
      if (typeof u === "string") pushUnique(out, absolutize(u, base));
    }
  }
}

function productNodes(idx: JsonLdIndex): Node[] {
  const isProduct = (n: Node) => typesOf(n).some((t) => t === "Product" || t === "ProductGroup" || t === "IndividualProduct");
  const direct = idx.roots.filter(isProduct);
  // Prefer nodes that carry price data, then richer ones.
  return direct.sort((a, b) => score(b) - score(a));
  function score(n: Node) {
    return (n.offers ? 2 : 0) + (n.hasVariant ? 2 : 0) + (n.name ? 1 : 0) + (typesOf(n).includes("ProductGroup") ? 1 : 0);
  }
}

function fromJsonLd(html: string, url: string): Omit<ParsedProduct, "via"> | null {
  const idx = indexJsonLd(readJsonLdBlocks(html));
  const nodes = productNodes(idx);
  if (!nodes.length) return null;
  const node = nodes[0];

  const facts: OfferFact[] = [];
  const topSize = sizeOf(node);
  facts.push(...offerFacts(node.offers, idx, topSize));
  const variants = asArray(node.hasVariant).map((v) => deref(v, idx)).filter(isObj);
  for (const v of variants) facts.push(...offerFacts(v.offers, idx, sizeOf(v)));
  // A second Product node (e.g. one per variant) in the same page.
  for (const other of nodes.slice(1)) {
    if (other !== node && !facts.length) facts.push(...offerFacts(other.offers, idx, sizeOf(other)));
  }

  const inStock = facts.filter((f) => f.availability === "in_stock");
  const pool = inStock.length ? inStock : facts.filter((f) => f.availability !== "out_of_stock");
  const priced = (pool.length ? pool : facts).slice().sort((a, b) => a.cents - b.cents)[0];

  let availability: Availability = "unknown";
  if (facts.some((f) => f.availability === "in_stock")) availability = "in_stock";
  else if (facts.length && facts.every((f) => f.availability === "out_of_stock")) availability = "out_of_stock";

  const sizes: string[] = [];
  const sizeSource = inStock.length ? inStock : facts.filter((f) => f.availability !== "out_of_stock");
  for (const f of sizeSource.length ? sizeSource : facts) pushUnique(sizes, f.size);

  const images: string[] = [];
  imagesFrom(node.image, url, idx, images);
  for (const v of variants) imagesFrom(v.image, url, idx, images);

  return {
    title: cleanText(node.name, 300),
    priceCents: priced ? priced.cents : null,
    currency: priced?.currency ?? null,
    images,
    availability,
    sizes,
    description: cleanText(node.description),
  };
}

// ---------------------------------------------------------------------------
// Open Graph / product meta tags / microdata
// ---------------------------------------------------------------------------

function fromMeta(html: string, url: string): Omit<ParsedProduct, "via"> {
  const meta = readMeta(html);
  const first = (...keys: string[]) => metaAll(meta, ...keys)[0] ?? null;

  let priceCents: number | null = null;
  for (const raw of metaAll(meta, "product:price:amount", "og:price:amount", "product:sale_price:amount", "price")) {
    priceCents = parsePriceToCents(raw);
    if (priceCents !== null) break;
  }
  if (priceCents === null) {
    // Microdata: <span itemprop="price" content="48.00"> (content attr handled in readMeta for <meta>)
    const m = html.match(/itemprop\s*=\s*["']price["'][^>]*?content\s*=\s*["']([^"']+)["']/i);
    if (m) priceCents = parsePriceToCents(m[1]);
  }
  const currency =
    first("product:price:currency", "og:price:currency", "pricecurrency")?.toUpperCase() ??
    html.match(/itemprop\s*=\s*["']priceCurrency["'][^>]*?content\s*=\s*["']([A-Za-z]{3})["']/i)?.[1]?.toUpperCase() ??
    null;

  const avRaw = first("product:availability", "og:availability", "availability");
  let availability: Availability = "unknown";
  if (avRaw) {
    const s = avRaw.toLowerCase().replace(/[\s_-]/g, "");
    if (/outofstock|soldout|oos|discontinued/.test(s)) availability = "out_of_stock";
    else if (/instock|available|limited/.test(s)) availability = "in_stock";
  }

  const images: string[] = [];
  for (const i of metaAll(meta, "og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src")) {
    pushUnique(images, absolutize(i, url));
  }

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return {
    title: cleanText(first("og:title", "twitter:title") ?? titleTag, 300),
    priceCents,
    currency,
    images,
    availability,
    sizes: [],
    description: cleanText(first("og:description", "description", "twitter:description")),
  };
}

/**
 * Parse a product page: JSON-LD Product first, then Open Graph / product meta tags.
 * Pure and synchronous, so checkout can run it without any model call.
 * Returns via: "none" when neither strategy found a price.
 */
export function parseProduct(html: string, url: string): ParsedProduct {
  let ld: Omit<ParsedProduct, "via"> | null = null;
  try {
    ld = fromJsonLd(html, url);
  } catch {
    ld = null;
  }
  const og = fromMeta(html, url);
  const ldHasPrice = ld !== null && ld.priceCents !== null;

  if (ld && ldHasPrice) {
    const images = [...ld.images];
    for (const i of og.images) pushUnique(images, i);
    return {
      title: ld.title ?? og.title,
      priceCents: ld.priceCents,
      currency: ld.currency ?? og.currency,
      images,
      availability: ld.availability !== "unknown" ? ld.availability : og.availability,
      sizes: ld.sizes,
      description: ld.description ?? og.description,
      via: "json-ld",
    };
  }
  if (og.priceCents !== null) {
    const images = [...(ld?.images ?? [])];
    for (const i of og.images) pushUnique(images, i);
    return {
      ...og,
      title: og.title ?? ld?.title ?? null,
      images,
      sizes: ld?.sizes ?? [],
      availability: og.availability !== "unknown" ? og.availability : (ld?.availability ?? "unknown"),
      description: og.description ?? ld?.description ?? null,
      via: "open-graph",
    };
  }
  const images = [...(ld?.images ?? [])];
  for (const i of og.images) pushUnique(images, i);
  return {
    title: ld?.title ?? og.title,
    priceCents: null,
    currency: null,
    images,
    availability: ld?.availability ?? og.availability,
    sizes: ld?.sizes ?? [],
    description: ld?.description ?? og.description,
    via: "none",
  };
}

/** Parsed JSON-LD Product/ProductGroup root nodes, for callers that want brand/seller hints. */
export function readProductJsonLdNodes(html: string): Record<string, unknown>[] {
  return productNodes(indexJsonLd(readJsonLdBlocks(html)));
}

// ---------------------------------------------------------------------------
// Claude fallback (pipeline only; dynamic imports keep parseProduct dependency-free)
// ---------------------------------------------------------------------------

const MAX_PAGE_TEXT = 12_000;

/** Claude extraction fallback for pages without structured data (pipeline only). */
export async function extractProductWithClaude(html: string, url: string): Promise<ParsedProduct> {
  const [{ generateText, Output }, { z }, { sonnet }] = await Promise.all([
    import("ai"),
    import("zod"),
    import("../ai/models"),
  ]);
  const meta = fromMeta(html, url);
  const text = htmlToText(html).slice(0, MAX_PAGE_TEXT);
  const schema = z.object({
    isProductPage: z.boolean().describe("False for category, search, blog or error pages."),
    title: z.string().nullable(),
    priceUsd: z.number().nullable().describe("Current selling price in US dollars for one unit, e.g. 48.5. Null if not shown."),
    currency: z.string().nullable().describe("ISO currency code of the price, e.g. USD."),
    availability: z.enum(["in_stock", "out_of_stock", "unknown"]),
    sizes: z.array(z.string()).describe("Size options exactly as printed. Empty if one size or none shown."),
    description: z.string().nullable().describe("One or two factual sentences (materials, condition)."),
  });
  const { output } = await generateText({
    model: sonnet(),
    output: Output.object({ schema }),
    instructions:
      "You extract product facts from the visible text of a merchant web page. Use only what the text states. Never guess a price.",
    prompt: `URL: ${url}\n\nPage text (truncated):\n${text}`,
  });
  const priceCents = output.isProductPage ? parsePriceToCents(output.priceUsd) : null;
  return {
    title: output.title ?? meta.title,
    priceCents,
    currency: priceCents === null ? null : (output.currency?.toUpperCase() ?? null),
    images: meta.images,
    availability: output.availability,
    sizes: output.sizes,
    description: output.description ?? meta.description,
    via: priceCents === null ? "none" : "claude",
  };
}
