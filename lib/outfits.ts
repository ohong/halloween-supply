import type { CostumeView, Piece, PieceView, ProductOption } from "./types";
import { isExplicitlyTooLate } from "./stylist/timing";

export type PieceUse = "buy" | "owned" | "skip";
export type ShoppingBrief = {
  budget: string;
  eventDate: string;
  notes?: string;
  preference: "styling" | "local" | "secondhand";
  sizes: Partial<Record<string, string>>;
  pieceSizes?: Record<string, string>;
};
export type OutfitLine = { view: PieceView; option?: ProductOption; use: PieceUse };
export type OutfitPlan = {
  id: "cost" | "match" | "shops";
  title: string;
  explanation: string;
  lines: OutfitLine[];
  total: number;
  shops: number;
  missing: string[];
  unknownSizes: string[];
  unknownStock: boolean;
  overBudget: boolean;
};

export const emptyBrief: ShoppingBrief = { budget: "", eventDate: "", preference: "styling", sizes: {} };

export function requestedSize(brief: ShoppingBrief, piece: Pick<Piece, "id" | "sizeKind">) {
  return (brief.pieceSizes?.[piece.id] ?? brief.sizes[piece.sizeKind] ?? "").trim();
}

export function sizeMatches(option: ProductOption, size: string) {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  return !size || !option.product.sizes.length || option.product.sizes.some((offered) => normalize(offered) === normalize(size));
}

function penalty(option: ProductOption, brief: ShoppingBrief) {
  const preferred = brief.preference === "local" ? option.pick.isLocal
    : brief.preference === "secondhand" ? ["vintage", "secondhand"].includes(option.merchant.kind) : true;
  return option.pick.rank + (preferred ? 0 : 10);
}

/** Evaluate complete combinations, rather than optimizing each piece independently.
 * The catalog has a handful of pieces with three options each. Keep only candidates
 * that can improve cost or styling for their merchant; this also bounds duplicate data.
 */
export function compareOutfits(costume: CostumeView, brief: ShoppingBrief, uses: Record<string, PieceUse>): OutfitPlan[] {
  const amount = Number(brief.budget);
  const budget = brief.budget.trim() && Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : Infinity;
  const rows = costume.pieces.map((view) => {
    const requested = uses[view.piece.id] ?? "buy";
    const use = requested === "skip" && view.piece.required ? "buy" : requested;
    const size = requestedSize(brief, view.piece);
    const options = use === "buy" ? view.options.filter((option) =>
      option.product.availability !== "out_of_stock" && Number.isSafeInteger(option.product.priceCents)
      && option.product.priceCents > 0 && sizeMatches(option, size) && !isExplicitlyTooLate(option.product, brief.eventDate),
    ) : [];
    return { view, use, options };
  });
  type Candidate = { lines: OutfitLine[]; total: number; merchants: Set<string>; rank: number };
  // For the same merchants, a state that costs more and matches less can never win.
  let states: Candidate[] = [{ lines: [], total: 0, merchants: new Set(), rank: 0 }];
  for (const row of rows) {
    const next = new Map<string, Candidate[]>();
    for (const state of states) {
      for (const option of row.options.length ? row.options : [undefined]) {
        const candidate = {
          lines: [...state.lines, { view: row.view, use: row.use, option }],
          total: state.total + (option?.product.priceCents ?? 0),
          merchants: new Set([...state.merchants, ...(option ? [option.merchant.id] : [])]),
          rank: state.rank + (option ? penalty(option, brief) : 0),
        };
        const key = [...candidate.merchants].sort().join("|");
        const frontier = next.get(key) ?? [];
        if (frontier.some((other) => other.total <= candidate.total && other.rank <= candidate.rank)) continue;
        next.set(key, [...frontier.filter((other) => !(candidate.total <= other.total && candidate.rank <= other.rank)), candidate]);
      }
    }
    states = [...next.values()].flat();
  }
  const affordable = states.filter((state) => state.total <= budget);
  const pool = affordable.length ? affordable : [...states].sort((a, b) => a.total - b.total || a.rank - b.rank).slice(0, 1);
  const cheapest = [...pool].sort((a, b) => a.total - b.total || a.rank - b.rank)[0];
  const best = [...pool].sort((a, b) => a.rank - b.rank || a.total - b.total)[0];
  const fewest = [...pool].sort((a, b) => a.merchants.size - b.merchants.size || a.total - b.total || a.rank - b.rank)[0];
  return ([
    ["cost", "Lowest cost", "Lowest pieces subtotal among the matching catalog options.", cheapest],
    ["match", "Closest to the look", brief.preference === "styling" ? "Favors our styling picks within your budget." : `Favors ${brief.preference === "local" ? "Bay Area shops" : "vintage and secondhand shops"}, then our styling picks.`, best],
    ["shops", "Fewest shops", "Fewest merchants within your budget, then the lowest pieces subtotal.", fewest],
  ] as const).map(([id, title, explanation, state]) => ({
    id, title, explanation, lines: state.lines, total: state.total, shops: state.merchants.size,
    missing: state.lines.filter((line) => line.use === "buy" && !line.option).map((line) => line.view.piece.name),
    unknownSizes: state.lines.filter((line) => line.use === "buy" && line.option && line.view.piece.sizeKind !== "one_size"
      && (!requestedSize(brief, line.view.piece) || !line.option.product.sizes.length)).map((line) => line.view.piece.name),
    unknownStock: state.lines.some((line) => line.option?.product.availability === "unknown"),
    overBudget: state.total > budget,
  }));
}
