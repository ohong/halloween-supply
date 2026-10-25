// Discover product pages with Firecrawl, then apply merchant filters.
import { searchWeb } from "../../lib/firecrawl/client";
import { hostnameOf, isBlockedDomain, isNoiseDomain } from "../../lib/sourcing/blocklist";
import { mapLimit } from "../../lib/sourcing/pool";
import type { Piece } from "../../lib/types";
import { curatedCandidates } from "./curated";

export interface Candidate {
  url: string;
  title: string;
  source?: string;
  /** Preserve a researched color when the merchant groups colors on one page. */
  preferredColor?: string;
}

const TRACKING = /^(utm_|gclid|fbclid|srsltid|ref$|ref_|pf_rd|cmpid)/i;

export function canonicalUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.replace(/^www\./, "");
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** Reject obvious non-product pages (category, search, blog, shop home). */
export function looksLikeProductUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.replace(/^www\./, "");
  const p = u.pathname.toLowerCase();
  if (/(^|\.)etsy\.com$/.test(host)) return /\/listing\/\d+/.test(p);
  if (p === "/" || p === "") return false;
  if (/\/collections\/[^/]+\/?$/.test(p) || (p.includes("/collections/") && !p.includes("/products/"))) return false;
  if (/\/(search|category|categories|blog|blogs|articles?|news|tag|tags|guide|guides|wiki)(\/|$)/.test(p)) return false;
  return true;
}

export interface SearchOptions {
  maxCandidates?: number;
  perDomain?: number;
  log?: (msg: string) => void;
}

/** Search each query once; merchant prices are confirmed from the product page. */
export async function searchPiece(piece: Piece, opts: SearchOptions = {}): Promise<Candidate[]> {
  const max = opts.maxCandidates ?? 10;
  const perDomain = opts.perDomain ?? 2;
  const settled = await mapLimit(piece.queries, 2, (query) => searchWeb(query, { cache: true, timeoutMs: 25_000 }));
  const discovered: Candidate[] = [];
  let dropped = 0;
  settled.forEach((result, i) => {
    if (!result.ok) {
      opts.log?.(`  search failed for "${piece.queries[i]}": ${(result.error as Error).message}`);
      return;
    }
    for (const item of result.value) discovered.push({ url: item.url, title: item.title, source: "Firecrawl search" });
  });

  const seen = new Set<string>();
  const perHost = new Map<string, number>();
  const out: Candidate[] = [];
  for (const c of [...curatedCandidates(piece.id), ...discovered]) {
    const url = canonicalUrl(c.url);
    if (!url) continue;
    if (isBlockedDomain(url)) {
      dropped++;
      continue;
    }
    if (isNoiseDomain(url) || !looksLikeProductUrl(url) || seen.has(`${url}:${c.preferredColor ?? ""}`)) continue;
    const host = hostnameOf(url) ?? "";
    const cap = c.source === "merchant catalog discovery" ? 5 : host.endsWith("etsy.com") ? perDomain * 2 : perDomain;
    if ((perHost.get(host) ?? 0) >= cap) continue;
    seen.add(`${url}:${c.preferredColor ?? ""}`);
    perHost.set(host, (perHost.get(host) ?? 0) + 1);
    out.push({ ...c, url });
    if (out.length >= max) break;
  }
  opts.log?.(`  ${piece.id}: ${discovered.length} search results, ${dropped} blocked, ${out.length} candidates`);
  return out;
}
