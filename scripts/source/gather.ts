// Step 3 + 4: fetch each candidate through Web Unlocker and parse it (JSON-LD / OG, then Claude).
import { fetchProductPage } from "../../lib/brightdata/client";
import { extractMerchantHints, type MerchantHints } from "../../lib/products/hints";
import { extractProductWithClaude, parseProduct, type ParsedProduct } from "../../lib/products/parse";
import { cached, hashKey } from "../../lib/sourcing/cache";
import { isBlockedDomain, registrableDomain } from "../../lib/sourcing/blocklist";
import { mapLimit } from "../../lib/sourcing/pool";
import type { Candidate } from "./search";

export interface PricedCandidate {
  url: string;
  domain: string;
  serpTitle: string;
  parsed: ParsedProduct & { priceCents: number; title: string };
  hints: MerchantHints;
}

export interface GatherOptions {
  concurrency?: number;
  maxClaudeFallbacks?: number;
  log?: (msg: string) => void;
}

export async function gatherCandidates(candidates: Candidate[], opts: GatherOptions = {}): Promise<PricedCandidate[]> {
  let claudeBudget = opts.maxClaudeFallbacks ?? 3;
  const results = await mapLimit(candidates, opts.concurrency ?? 4, async (c): Promise<PricedCandidate | null> => {
    const page = await fetchProductPage(c.url, { cache: true });
    const finalUrl = page.finalUrl && !isBlockedDomain(page.finalUrl) ? page.finalUrl : null;
    if (!finalUrl) {
      opts.log?.(`  skip ${c.url}: redirects to a blocked domain`);
      return null;
    }
    if (page.status >= 400 || page.html.length < 500) {
      opts.log?.(`  skip ${c.url}: status ${page.status}, ${page.html.length} bytes`);
      return null;
    }
    let parsed = parseProduct(page.html, finalUrl);
    if (parsed.via === "none" && claudeBudget > 0) {
      claudeBudget--;
      try {
        parsed = await cached("claude-extract", { url: finalUrl, h: hashKey(page.html.length + page.html.slice(0, 4000)) }, () =>
          extractProductWithClaude(page.html, finalUrl),
        );
      } catch (e) {
        opts.log?.(`  claude extraction failed for ${c.url}: ${(e as Error).message}`);
      }
    }
    const { priceCents, title } = parsed;
    if (priceCents === null || !title) {
      opts.log?.(`  skip ${c.url}: no price/title (${parsed.via})`);
      return null;
    }
    if (parsed.currency && parsed.currency !== "USD") {
      opts.log?.(`  skip ${c.url}: currency ${parsed.currency}`);
      return null;
    }
    if (parsed.availability === "out_of_stock") {
      opts.log?.(`  skip ${c.url}: out of stock`);
      return null;
    }
    if (priceCents < 200) return null;
    return {
      url: finalUrl,
      domain: registrableDomain(finalUrl) ?? "",
      serpTitle: c.title,
      parsed: { ...parsed, priceCents, title },
      hints: extractMerchantHints(page.html, finalUrl),
    };
  });
  const out: PricedCandidate[] = [];
  results.forEach((r, i) => {
    if (!r.ok) opts.log?.(`  fetch failed ${candidates[i].url}: ${(r.error as Error).message}`);
    else if (r.value) out.push(r.value);
  });
  return out;
}
