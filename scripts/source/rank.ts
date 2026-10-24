// Step 5: Claude scores candidates per piece, with a Bay Area boost; picks default + 2 alternatives.
import { z } from "zod";
import { BAY_AREA_CITIES } from "../../lib/products/hints";
import { registrableDomain } from "../../lib/sourcing/blocklist";
import { askObject } from "../../lib/sourcing/llm";
import type { Merchant, MerchantKind, Neighborhood, Piece } from "../../lib/types";
import type { PricedCandidate } from "./gather";
import { slugify, type CostumeSource } from "./decompose";

export const LOCAL_BOOST = 1.5;

const KINDS = ["etsy", "vintage", "secondhand", "pawn", "dtc", "boutique"] as const;

const rankSchema = z.object({
  candidates: z.array(
    z.object({
      index: z.number().describe("Index of the candidate as listed."),
      fit: z.number().describe("0-10: how well it matches the piece and the costume look."),
      uniqueness: z.number().describe("0-10: distinctive, not generic mass-market."),
      quality: z.number().describe("0-10: apparent material and build quality, value for the price."),
      reason: z.string().describe("One factual sentence on why it suits the piece (material, era, look). Do not mention ranks or scores."),
      merchantName: z.string().describe("The shop or brand name as customers know it."),
      merchantKind: z.enum(KINDS),
      bayAreaCity: z.string().nullable().describe("Bay Area city the merchant is based in, ONLY if the page text, hints or well-known fact says so. Else null."),
      neighborhood: z.string().nullable().describe("Neighborhood within the city (for example Mission District), only if known."),
      tags: z.array(z.string()).describe("Up to 5 lowercase tags, e.g. vintage, handmade, secondhand, western-wear, felt, leather, sequin."),
    }),
  ),
});

export interface RankedPick {
  candidate: PricedCandidate;
  rank: number;
  reason: string;
  total: number;
  merchant: Merchant;
  neighborhood: Neighborhood | null;
  tagSlugs: string[];
  isLocal: boolean;
}

const CITY_ABBR: Record<string, string> = { "san francisco": "sf", oakland: "oak", berkeley: "berk", "san jose": "sj" };

function matchCity(city: string | null): string | null {
  if (!city) return null;
  return BAY_AREA_CITIES.find((c) => c.toLowerCase() === city.trim().toLowerCase()) ?? null;
}

export function buildMerchant(
  c: PricedCandidate,
  r: { merchantName: string; merchantKind: MerchantKind; city: string | null; neighborhood: string | null },
): { merchant: Merchant; neighborhood: Neighborhood | null } {
  const domain = registrableDomain(c.url) ?? c.domain;
  const isEtsy = domain === "etsy.com";
  const shop = isEtsy ? (c.hints.brand ?? r.merchantName) : r.merchantName;
  const id = isEtsy ? `etsy-${slugify(shop) || "shop"}` : slugify(domain) || "merchant";
  const origin = (() => {
    try {
      return new URL(c.url).origin;
    } catch {
      return `https://${domain}`;
    }
  })();
  let neighborhood: Neighborhood | null = null;
  if (r.city) {
    const abbr = CITY_ABBR[r.city.toLowerCase()] ?? slugify(r.city);
    neighborhood = r.neighborhood
      ? { id: `${abbr}-${slugify(r.neighborhood)}`, name: r.neighborhood, city: r.city, region: "Bay Area" }
      : { id: abbr, name: r.city, city: r.city, region: "Bay Area" };
  }
  return {
    merchant: {
      id,
      name: shop,
      domain,
      url: isEtsy ? `https://www.etsy.com/shop/${encodeURIComponent(shop.replace(/\s+/g, ""))}` : origin,
      kind: isEtsy ? "etsy" : r.merchantKind,
      neighborhoodId: neighborhood?.id ?? null,
    },
    neighborhood,
  };
}

export async function rankPiece(costume: CostumeSource, piece: Piece, candidates: PricedCandidate[]): Promise<RankedPick[]> {
  if (candidates.length === 0) return [];
  const listing = candidates
    .map((c, i) =>
      [
        `#${i} ${c.parsed.title}`,
        `  url: ${c.url}`,
        `  price: $${(c.parsed.priceCents / 100).toFixed(2)}${c.parsed.sizes.length ? ` | sizes: ${c.parsed.sizes.slice(0, 12).join(", ")}` : ""}`,
        `  description: ${(c.parsed.description ?? "").slice(0, 280)}`,
        `  site: ${c.hints.siteName ?? c.domain} | brand/shop: ${c.hints.brand ?? "?"}`,
        `  location hints: ${c.hints.locationSnippets.join(" || ") || "none"} | Bay Area mentions: ${c.hints.bayAreaMentions.join(", ") || "none"}`,
      ].join("\n"),
    )
    .join("\n");

  const out = await askObject({
    label: `rank:${costume.slug}:${piece.id}`,
    schema: rankSchema,
    instructions:
      "You are the buyer for a curated Halloween costume store that sources from independent merchants. Score every candidate for the piece. " +
      "Be strict: a candidate that is the wrong item, a kids' version, a costume-bag knockoff or the wrong colour gets fit under 4. " +
      "Prefer real materials and distinctive listings. Identify the merchant and, only with evidence, its Bay Area location.",
    prompt: `Costume: ${costume.name} (${costume.description})\nPiece: ${piece.name} (${piece.category})\nStyle notes: ${piece.styleNotes}\n\nCandidates:\n${listing}\n\nScore every candidate.`,
  });

  const scored = out.candidates
    .filter((r) => Number.isInteger(r.index) && r.index >= 0 && r.index < candidates.length && r.fit >= 4)
    .map((r) => {
      const c = candidates[r.index];
      const city = matchCity(r.bayAreaCity);
      const { merchant, neighborhood } = buildMerchant(c, {
        merchantName: r.merchantName,
        merchantKind: r.merchantKind,
        city,
        neighborhood: city ? r.neighborhood : null,
      });
      const base = r.fit * 0.5 + r.uniqueness * 0.2 + r.quality * 0.3;
      const tags = [...new Set(r.tags.map(slugify).filter((t) => t && t !== "local"))].slice(0, 5);
      if (city) tags.push("local");
      return { candidate: c, reason: r.reason.trim(), total: base + (city ? LOCAL_BOOST : 0), merchant, neighborhood, tagSlugs: tags, isLocal: !!city };
    })
    .sort((a, b) => b.total - a.total);

  // Greedy pick: prefer distinct merchants, then fill with the best remaining.
  const picked: typeof scored = [];
  for (const s of scored) if (picked.length < 3 && !picked.some((p) => p.merchant.id === s.merchant.id)) picked.push(s);
  for (const s of scored) if (picked.length < 3 && !picked.includes(s)) picked.push(s);
  picked.sort((a, b) => b.total - a.total);
  return picked.map((p, rank) => ({ ...p, rank }));
}
