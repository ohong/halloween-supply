import { compareOutfits, emptyBrief } from "@/lib/outfits";
import type { CostumeView } from "@/lib/types";
import type { MirrorAction, MirrorOutfit } from "./types";

export function createOutfit(costume: CostumeView, initial: Partial<MirrorOutfit> = {}): MirrorOutfit {
  const selection: MirrorOutfit["selection"] = {};
  const uses: MirrorOutfit["uses"] = {};
  for (const { piece, options } of costume.pieces) {
    const selected = options.find(({ product }) => product.id === initial.selection?.[piece.id] && product.availability !== "out_of_stock")
      ?? options.find(({ product }) => product.availability !== "out_of_stock");
    if (selected) selection[piece.id] = selected.product.id;
    const use = initial.uses?.[piece.id];
    uses[piece.id] = use === "owned" ? "owned" : use === "skip" && !piece.required ? "skip" : "buy";
  }
  const ids = new Set(costume.pieces.map(({ piece }) => piece.id));
  return { ...(initial.mixes?.length ? { mixes: initial.mixes.map(ref => ({ ...ref })) } : {}), selection, uses, locked: [...new Set(initial.locked ?? [])].filter((id) => ids.has(id)), budget: validBudget(initial.budget ?? "") ?? "" };
}

function validBudget(amount: string) {
  if (!amount.trim()) return "";
  const number = Number(amount);
  return Number.isFinite(number) && number >= 0 && number <= 1_000_000 ? String(Math.round(number * 100) / 100) : null;
}

export function outfitTotal(costume: CostumeView, outfit: MirrorOutfit): number {
  return costume.pieces.reduce((total, { piece, options }) => {
    if (outfit.uses[piece.id] !== "buy") return total;
    return total + (options.find(({ product }) => product.id === outfit.selection[piece.id])?.product.priceCents ?? 0);
  }, 0);
}

/** The catalog, not model-generated product details, decides what can be selected.
 * History and camera actions are handled by the view; this function is pure.
 */
export function applyActions(costume: CostumeView, previous: MirrorOutfit, actions: MirrorAction[]): { outfit: MirrorOutfit; message?: string } {
  const outfit = createOutfit(costume, previous);
  const messages: string[] = [];
  for (const action of actions) {
    if (action.type === "budget") {
      const budget = validBudget(action.amount);
      if (budget === null) messages.push("Enter a valid budget.");
      else outfit.budget = budget;
      continue;
    }
    if (action.type === "cheapest") {
      const constrained: CostumeView = { ...costume, pieces: costume.pieces.map((view) => outfit.locked.includes(view.piece.id)
        ? { ...view, options: view.options.filter(({ product }) => product.id === outfit.selection[view.piece.id]) } : view) };
      const plan = compareOutfits(constrained, { ...emptyBrief, budget: outfit.budget }, outfit.uses)[0];
      for (const { view, option } of plan.lines) if (option) outfit.selection[view.piece.id] = option.product.id;
      if (plan.overBudget) messages.push("This is the lowest available subtotal with your kept pieces. It is still over budget.");
      continue;
    }
    if (!("pieceId" in action)) continue;
    const view = costume.pieces.find(({ piece }) => piece.id === action.pieceId);
    if (!view) { messages.push("That piece is not in this costume."); continue; }
    if (action.type === "lock") {
      outfit.locked = action.locked ? [...new Set([...outfit.locked, action.pieceId])] : outfit.locked.filter((id) => id !== action.pieceId);
      continue;
    }
    if (outfit.locked.includes(action.pieceId)) { messages.push(`${view.piece.name} is kept. Unlock it to make changes.`); continue; }
    if (action.type === "select") {
      const option = view.options.find(({ product }) => product.id === action.productId && product.availability !== "out_of_stock");
      if (!option) { messages.push("That option is unavailable. Choose another piece."); continue; }
      outfit.selection[action.pieceId] = option.product.id;
      outfit.uses[action.pieceId] = "buy";
    } else if (action.type === "use") {
      if (action.use === "skip" && view.piece.required) { messages.push(`${view.piece.name} is needed for this look. You can use your own instead.`); continue; }
      outfit.uses[action.pieceId] = action.use;
    }
  }
  return { outfit, ...(messages.length ? { message: [...new Set(messages)].join(" ") } : {}) };
}
