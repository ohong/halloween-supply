import type { CostumeView } from "@/lib/types";
import type { MirrorAction, MirrorMix, MirrorOutfit } from "./types";
import { createOutfit } from "./state";

/** Rebuild from the original look, so replacing and undoing never accumulate stale slots. */
export function composeMirrorCostume(base: CostumeView, mixes: readonly MirrorMix[], inventory: readonly CostumeView[]): CostumeView {
  if (mixes.length > 12) throw new Error("Keep at most twelve imported pieces in one outfit.");
  const replaced = new Set<string>();
  const imported = new Set<string>();
  const rows = mixes.map(ref => {
    const source = inventory.find(view => view.costume.slug === ref.costumeSlug)?.pieces.find(view => view.piece.id === ref.pieceId);
    if (!source?.options.some(option => option.product.id === ref.productId)) throw new Error("An imported product is no longer in the catalog. Search for it again.");
    const target = ref.replacesPieceId === null ? undefined : base.pieces.find(view => view.piece.id === ref.replacesPieceId);
    if (ref.replacesPieceId !== null && (!target || replaced.has(ref.replacesPieceId))) throw new Error("An outfit replacement is invalid.");
    if (imported.has(ref.pieceId) || (base.pieces.some(view => view.piece.id === ref.pieceId) && ref.replacesPieceId !== ref.pieceId)) throw new Error("That piece is already in your outfit.");
    imported.add(ref.pieceId);
    if (target) replaced.add(target.piece.id);
    return { ...source, piece: { ...source.piece, required: target?.piece.required ?? false, order: target?.piece.order ?? base.pieces.length + imported.size } };
  });
  const pieces = [...base.pieces.filter(view => !replaced.has(view.piece.id)), ...rows].sort((a, b) => a.piece.order - b.piece.order);
  if (pieces.length > 20) throw new Error("Keep at most twenty pieces in one outfit.");
  return { ...base, pieces };
}

/** References select real source pieces, keeping the original slot only as replacement provenance. */
export function mixMirrorPieces(base: CostumeView, current: CostumeView, previous: MirrorOutfit,
  actions: Extract<MirrorAction, { type: "mix" }>[], inventory: readonly CostumeView[]) {
  let mixes = [...(previous.mixes ?? [])];
  for (const action of actions) {
    const target = action.replacesPieceId;
    if (target && !current.pieces.some(view => view.piece.id === target)) throw new Error("That outfit piece changed. Please try again.");
    const old = target ? mixes.find(ref => ref.pieceId === target) : undefined;
    const originalTarget = old ? old.replacesPieceId : target;
    if (target && previous.locked.includes(target)) throw new Error("That piece is kept. Unlock it before replacing it.");
    if (current.pieces.some(view => view.piece.id === action.source.pieceId && view.piece.id !== target)) throw new Error("That piece is already in your outfit.");
    const source = inventory.find(view => view.costume.slug === action.source.costumeSlug)?.pieces.find(view => view.piece.id === action.source.pieceId);
    if (!source?.options.some(option => option.product.id === action.source.productId && option.product.availability !== "out_of_stock")) throw new Error("That product is unavailable. Choose another option.");
    mixes = mixes.filter(ref => ref.pieceId !== target && ref.pieceId !== action.source.pieceId);
    mixes.push({ ...action.source, replacesPieceId: originalTarget });
  }
  const costume = composeMirrorCostume(base, mixes, inventory);
  const selection = { ...previous.selection, ...Object.fromEntries(actions.map(action => [action.source.pieceId, action.source.productId])) };
  const uses = { ...previous.uses, ...Object.fromEntries(actions.map(action => [action.source.pieceId, "buy" as const])) };
  const outfit = createOutfit(costume, { ...previous, mixes, selection, uses });
  return { costume, outfit };
}
