// Step 2: SERP search per piece (shopping + organic), blocklist applied.
import { serpSearch } from "../../lib/brightdata/client";
import { hostnameOf, isBlockedDomain, isNoiseDomain } from "../../lib/sourcing/blocklist";
import { mapLimit } from "../../lib/sourcing/pool";
import type { Piece } from "../../lib/types";
import { curatedCandidates } from "./curated";

export interface Candidate {
  url: string;
  title: string;
  /** Price shown in the SERP, if any (cents). */
  serpPriceCents?: number;
  source?: string;
  via: "shopping" | "organic";
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

/** Run every query for a piece (shopping + organic), drop blocked/noise domains, dedupe, cap per domain. */
export async function searchPiece(piece: Piece, opts: SearchOptions = {}): Promise<Candidate[]> {
  const max = opts.maxCandidates ?? 10;
  const perDomain = opts.perDomain ?? 2;
  const jobs = piece.queries.flatMap((q) => [
    { q, shopping: true },
    { q, shopping: false },
  ]);
  const settled = await mapLimit(jobs, 3, (j) => serpSearch(j.q, { shopping: j.shopping, cache: true, timeoutMs: 25_000, retries: 0 }));

  const shopping: Candidate[] = [];
  const organic: Candidate[] = [];
  let dropped = 0;
  settled.forEach((r, i) => {
    if (!r.ok) {
      opts.log?.(`  search failed for "${jobs[i].q}" (${jobs[i].shopping ? "shopping" : "organic"}): ${(r.error as Error).message}`);
      return;
    }
    for (const s of r.value.shopping) {
      shopping.push({ url: s.link, title: s.title, serpPriceCents: s.priceCents, source: s.source, via: "shopping" });
    }
    for (const o of r.value.organic) organic.push({ url: o.link, title: o.title, via: "organic" });
  });

  const seen = new Set<string>();
  const perHost = new Map<string, number>();
  const out: Candidate[] = [];
  for (const c of [...curatedCandidates(piece.id), ...shopping, ...organic]) {
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
  opts.log?.(`  ${piece.id}: ${shopping.length} shopping + ${organic.length} organic results, ${dropped} blocked, ${out.length} candidates`);
  return out;
}
