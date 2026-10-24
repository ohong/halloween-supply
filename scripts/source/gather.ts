// Step 3 + 4: fetch each candidate through Web Unlocker and parse it (JSON-LD / OG, then Claude).
import { fetchProductPage } from "../../lib/brightdata/client";
import { extractMerchantHints, type MerchantHints } from "../../lib/products/hints";
import { extractProductWithClaude, htmlToText, parseProduct, type ParsedProduct } from "../../lib/products/parse";
import { readShopifyProduct, selectShopifyVariants } from "../../lib/products/shopify";
import { cached, hashKey } from "../../lib/sourcing/cache";
import { isBlockedDomain, registrableDomain } from "../../lib/sourcing/blocklist";
import { mapLimit } from "../../lib/sourcing/pool";
import type { Candidate } from "./search";
import { researchedMerchantLocation } from "./curated";

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
    const shopify = await readShopifyProduct(finalUrl);
    let productUrl = finalUrl;
    const pageCurrency = parsed.currency ?? page.html.match(/Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/)?.[1];
    if (shopify && pageCurrency === "USD") {
      const variants = selectShopifyVariants(shopify, c.preferredColor);
      if (!variants.length) {
        opts.log?.(`  skip ${c.url}: no in-stock variants${c.preferredColor ? ` in ${c.preferredColor}` : ""}`);
        return null;
      }
      const first = variants[0];
      const chosen = new URL(finalUrl);
      chosen.searchParams.set("variant", String(first.id));
      productUrl = chosen.toString();
      const src = first.featured_image?.src;
      parsed = { ...parsed, title: c.preferredColor ? `${shopify.title} — ${c.preferredColor}` : shopify.title,
        priceCents: first.price, currency: "USD", availability: "in_stock", sizes: variants.map((v) => v.title), via: "shopify",
        description: parsed.description ?? htmlToText(shopify.description ?? "").slice(0,600),
        images: [...new Set([...(src ? [new URL(src, finalUrl).toString()] : []), ...parsed.images, ...shopify.images.map((i) => new URL(i, finalUrl).toString())])],
      };
    }
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
    if (parsed.availability !== "in_stock") {
      opts.log?.(`  skip ${c.url}: stock is ${parsed.availability}`);
      return null;
    }
    if (priceCents < 200 || !parsed.images.length) return null;
    const hints = extractMerchantHints(page.html, finalUrl);
    const researched = researchedMerchantLocation(finalUrl);
    if (researched) {
      hints.siteName = researched.name;
      hints.bayAreaMentions = [...new Set([...hints.bayAreaMentions, researched.city])];
      hints.locationSnippets.unshift(`${researched.name}, ${researched.neighborhood}, ${researched.city}. Official address evidence: ${researched.evidence}`);
    }
    return {
      url: productUrl,
      domain: registrableDomain(finalUrl) ?? "",
      serpTitle: c.title,
      parsed: { ...parsed, priceCents, title },
      hints,
    };
  });
  const out: PricedCandidate[] = [];
  results.forEach((r, i) => {
    if (!r.ok) opts.log?.(`  fetch failed ${candidates[i].url}: ${(r.error as Error).message}`);
    else if (r.value) out.push(r.value);
  });
  return out;
}
