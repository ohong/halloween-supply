import type { MirrorCatalogMatch } from "./types";
import storedTags from "./catalog-tags.json";

/** Fixed vocabularies keep tagging, the Decisions filter question and code-side filtering in one language. */
export const COLORS = ["black", "white", "red", "orange", "yellow", "green", "blue", "purple", "pink", "brown", "gray", "gold", "silver", "multicolor", "clear", "other"] as const;
export const MATERIALS = ["cotton", "polyester", "satin", "velvet", "leather", "faux-leather", "vinyl", "lace", "mesh-tulle", "fur", "knit", "denim", "metal", "plastic", "foam-latex", "felt", "sequin", "other"] as const;
export const STYLES = ["spooky", "gothic", "cute", "glam", "vintage", "sci-fi", "fantasy", "pirate", "western", "punk", "whimsical", "formal", "sporty", "historical"] as const;
/** Ceilings, in whole dollars, that the max_price question can choose. */
export const PRICE_CEILINGS = [10, 15, 20, 25, 30, 40, 50, 75, 100, 150] as const;

export type ProductTags = { colors: string[]; materials: string[]; styles: string[] };
export type CatalogFilters = {
  /** Piece ids of the chosen category: the caller resolves category names from piece.category. */
  pieceIds?: ReadonlySet<string>; color?: string; material?: string; style?: string;
  /** Hard ceiling in whole US dollars. */
  maxPriceDollars?: number;
  scope?: "other_costumes" | "this_costume";
  /** Free-text request: words found in a title, piece or costume name add a small ranking bonus (never filter). */
  query?: string;
};

const stopWords = new Set(["the", "and", "for", "what", "show", "does", "come", "with", "that", "this", "have", "any", "other", "costume", "costumes", "from", "under", "over", "can", "you", "get", "which", "are", "its", "one", "try", "use", "add", "pair", "piece"]);
const tagsById = storedTags as Record<string, ProductTags | undefined>;

export function priceBand(priceCents: number) {
  return priceCents < 1500 ? "under-15" : priceCents < 3000 ? "15-30" : priceCents < 6000 ? "30-60" : "60-plus";
}

/** Stored tags plus values derived from the catalog row. Untagged products return null stored tags. */
export function matchTags(match: MirrorCatalogMatch) {
  const stored = tagsById[match.productId] ?? null;
  const product = match.option.product;
  return {
    colors: stored?.colors ?? [], materials: stored?.materials ?? [], styles: stored?.styles ?? [], tagged: stored !== null,
    priceBand: priceBand(product.priceCents),
    inStock: product.availability === "in_stock",
  };
}

/**
 * Hard filters (category, scope, price) remove rows. Soft filters (color, material, style) only rank them, and
 * untagged products rank as possible matches instead of being dropped. Results are in-stock first and spread
 * across costumes so one look cannot fill the list.
 */
export function filterCandidates(matches: readonly MirrorCatalogMatch[], filters: CatalogFilters, currentCostumeSlug: string, limit = 40) {
  const soft = [["colors", filters.color], ["materials", filters.material], ["styles", filters.style]] as const;
  const words = (filters.query ?? "").toLowerCase().match(/[a-z]{3,}/g) ?? [];
  const terms = [...new Set(words.filter(word => !stopWords.has(word)).map(word => word.length > 3 ? word.replace(/s$/, "") : word))];
  const scored = new Map<string, { match: MirrorCatalogMatch; tier: string; score: number }>();
  for (const match of matches) {
    const product = match.option.product;
    if (filters.pieceIds && !filters.pieceIds.has(match.pieceId)) continue;
    if (filters.scope === "other_costumes" && match.costumeSlug === currentCostumeSlug) continue;
    if (filters.scope === "this_costume" && match.costumeSlug !== currentCostumeSlug) continue;
    if (filters.maxPriceDollars !== undefined && product.priceCents > filters.maxPriceDollars * 100) continue;
    const tags = matchTags(match);
    const text = `${product.title} ${match.pieceName} ${match.costumeName}`.toLowerCase();
    const lexical = terms.filter(term => text.includes(term)).length * 0.25;
    const score = lexical + soft.reduce((sum, [key, wanted]) => !wanted ? sum : tags[key].includes(wanted) ? sum + 1 : tags.tagged ? sum : sum + 0.5, 0);
    const stock = product.availability === "out_of_stock" ? 2 : product.availability === "in_stock" ? 0 : 1;
    const existing = scored.get(match.productId);
    if (!existing || score > existing.score) scored.set(match.productId, { match, score, tier: `${-score}|${stock}` });
  }
  const buckets = new Map<string, Map<string, MirrorCatalogMatch[]>>();
  for (const { match, tier } of scored.values()) {
    const byCostume = buckets.get(tier) ?? new Map<string, MirrorCatalogMatch[]>();
    byCostume.set(match.costumeSlug, [...(byCostume.get(match.costumeSlug) ?? []), match]);
    buckets.set(tier, byCostume);
  }
  const result: MirrorCatalogMatch[] = [];
  // Tier keys sort numerically by score descending (negated), then stock rank.
  const tiers = [...buckets.keys()].sort((a, b) => { const [sa, ka] = a.split("|").map(Number), [sb, kb] = b.split("|").map(Number); return sa - sb || ka - kb; });
  for (const tier of tiers) {
    const lists = [...buckets.get(tier)!.values()];
    for (let round = 0; result.length < limit && lists.some(list => list[round]); round++) {
      for (const list of lists) if (list[round] && result.length < limit) result.push(list[round]);
    }
    if (result.length >= limit) break;
  }
  return result;
}
