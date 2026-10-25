import { requestedSize, sizeMatches, type OutfitLine, type ShoppingBrief, type PieceUse } from "@/lib/outfits";
import type { CostumeView, ProductOption } from "@/lib/types";
import { StylistError } from "./contracts";
import { isExplicitlyTooLate } from "./timing";

export type Candidate = {
  id: string;
  lines: OutfitLine[];
  total: number;
  shops: number;
  preferredItems: number;
  unknownSizes: string[];
  unknownStockPieces: string[];
};

/** Parse decimal dollars exactly; floating-point rounding must not expand a budget. */
export function budgetInCents(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(value.trim())) throw new StylistError(400, "Enter a dollar amount with at most two decimal places.", "invalid_request");
  const [whole, fraction = ""] = value.trim().split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function isPreferred(option: ProductOption, preference: ShoppingBrief["preference"]) {
  return preference === "local" ? option.pick.isLocal
    : preference === "secondhand" ? ["vintage", "secondhand"].includes(option.merchant.kind) : false;
}

function describe(lines: OutfitLine[], brief: ShoppingBrief): Omit<Candidate, "id"> {
  const bought = lines.filter((line) => line.use === "buy" && line.option);
  return {
    lines,
    total: bought.reduce((sum, line) => sum + line.option!.product.priceCents, 0),
    shops: new Set(bought.map((line) => line.option!.merchant.id)).size,
    preferredItems: bought.filter((line) => isPreferred(line.option!, brief.preference)).length,
    unknownSizes: bought.filter((line) => line.view.piece.sizeKind !== "one_size"
      && (!requestedSize(brief, line.view.piece) || !line.option!.product.sizes.length)).map((line) => line.view.piece.name),
    unknownStockPieces: bought.filter((line) => line.option!.product.availability === "unknown").map((line) => line.view.piece.name),
  };
}

export function enumerateOutfits(costume: CostumeView, brief: ShoppingBrief, uses: Record<string, PieceUse>) {
  if (Object.keys(uses).some((id) => !costume.pieces.some(({ piece }) => piece.id === id))) throw new StylistError(400, "An outfit choice does not belong to this costume.", "invalid_request");
  if (Object.keys(brief.pieceSizes ?? {}).some((id) => !costume.pieces.some(({ piece }) => piece.id === id && piece.sizeKind !== "one_size"))) throw new StylistError(400, "A saved size does not belong to a sized piece in this costume.", "invalid_request");
  const rows = costume.pieces.map((view) => {
    const use = uses[view.piece.id] ?? "buy";
    if (use === "skip" && view.piece.required) throw new StylistError(400, `${view.piece.name} is required. Choose an option or mark it as owned.`, "invalid_request");
    const size = requestedSize(brief, view.piece);
    const seen = new Set<string>();
    const options = use === "buy" ? view.options.filter((option) => {
      const valid = option.product.availability !== "out_of_stock" && Number.isSafeInteger(option.product.priceCents)
        && option.product.priceCents > 0 && sizeMatches(option, size) && !isExplicitlyTooLate(option.product, brief.eventDate) && !seen.has(option.product.id);
      if (valid) seen.add(option.product.id);
      return valid;
    }) : [];
    return { view, use, options };
  });
  const unavailablePieces = rows.filter((row) => row.use === "buy" && !row.options.length).map((row) => row.view.piece.name);
  if (unavailablePieces.length) throw new StylistError(422, `No catalog option meets the size, stock, and stated timing constraints for ${unavailablePieces.join(", ")}. Change your choices or mark a piece as owned.`, "no_feasible_outfit", { unavailablePieces });
  // Seven pieces with three options produce 2,187 complete outfits. Keep the
  // exhaustive search bounded instead of silently dropping valid combinations.
  if (rows.reduce((count, row) => count * Math.max(row.options.length, 1), 1) > 5000) throw new StylistError(503, "This catalog is too large to compare right now.", "provider_unavailable");
  let combinations: OutfitLine[][] = [[]];
  for (const row of rows) combinations = combinations.flatMap((lines) => row.use === "buy"
    ? row.options.map((option) => [...lines, { view: row.view, use: row.use, option }])
    : [[...lines, { view: row.view, use: row.use }]]);
  const complete = combinations.map((lines, index) => ({ id: `outfit_${index + 1}`, ...describe(lines, brief) }));
  const minimumSubtotal = Math.min(...complete.map((candidate) => candidate.total));
  const budgetCents = budgetInCents(brief.budget);
  const affordable = complete.filter((candidate) => budgetCents === null || candidate.total <= budgetCents);
  if (!affordable.length) {
    const shortfall = minimumSubtotal - budgetCents!;
    throw new StylistError(422, `The lowest matching catalog subtotal is $${(minimumSubtotal / 100).toFixed(2)} before shipping and tax. Your pieces budget is $${(shortfall / 100).toFixed(2)} short.`, "budget_too_low", { minimumSubtotal, budgetCents, shortfall });
  }
  return { affordable, minimumSubtotal, budgetCents };
}
