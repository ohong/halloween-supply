import { z } from "zod";
import { mixSchema } from "../live-mirror/mix-schema";
import type { CostumeView } from "../types";

const id = z.string().regex(/^[\w-]{1,150}$/);
const ids = z.array(id).max(20);
const previewEdit = z.object({ color: z.string().trim().min(1).max(80).optional(), style: z.string().trim().min(1).max(160).optional() }).strict();
export const lookSelectionSchema = z.object({
  version: z.literal(1), costumeSlug: id,
  selection: z.array(z.object({ pieceId: id, productId: id }).strict()).max(20),
  ownedPieceIds: ids, skippedPieceIds: ids,
  mixes: z.array(mixSchema).max(12), model: z.enum(["male", "female"]),
  /** Appearance edits are preview instructions, never merchant variants. */
  previewEdits: z.record(id, previewEdit).refine(value => Object.keys(value).length <= 20).optional(),
}).strict().superRefine((value, context) => {
  const pieces = [...value.selection.map(row => row.pieceId), ...value.ownedPieceIds, ...value.skippedPieceIds];
  if (new Set(pieces).size !== pieces.length) context.addIssue({ code: "custom", message: "Choose each piece only once." });
});
export type LookSelection = z.infer<typeof lookSelectionSchema>;
export function validateLookSelection(value: unknown): LookSelection { return lookSelectionSchema.parse(value); }

export type ReadLookSelection =
  | { status: "none" }
  | { status: "invalid"; error: string }
  | { status: "valid"; snapshot: LookSelection | null; legacyProductIds: string[]; ownedPieceIds: string[]; skippedPieceIds: string[]; mixes: LookSelection["mixes"]; model?: LookSelection["model"]; previewEdits?: LookSelection["previewEdits"] };
const urlKeys = ["look", "mix", "owned", "skipped", "model", "selection"];
export function readLookSelection(search: string, costumeSlug: string): ReadLookSelection {
  const params = new URLSearchParams(search);
  if (!urlKeys.some(key => params.has(key))) return { status: "none" };
  try {
    if (search.length > 24_000) throw new Error();
    if (params.has("selection")) {
      const snapshot = validateLookSelection(JSON.parse(params.get("selection")!));
      if (snapshot.costumeSlug !== costumeSlug) throw new Error();
      return { status: "valid", snapshot, legacyProductIds: [], ownedPieceIds: snapshot.ownedPieceIds, skippedPieceIds: snapshot.skippedPieceIds, mixes: snapshot.mixes, model: snapshot.model, previewEdits: snapshot.previewEdits };
    }
    const split = (key: string) => params.get(key) ? ids.parse(params.get(key)!.split(",")) : [];
    const model = params.get("model");
    if (model !== null && model !== "male" && model !== "female") throw new Error();
    const legacyProductIds = split("look");
    const ownedPieceIds = split("owned"), skippedPieceIds = split("skipped");
    if (new Set([...ownedPieceIds, ...skippedPieceIds]).size !== ownedPieceIds.length + skippedPieceIds.length) throw new Error();
    return { status: "valid", snapshot: null, legacyProductIds, ownedPieceIds, skippedPieceIds,
      mixes: z.array(mixSchema).max(12).parse(JSON.parse(params.get("mix") ?? "[]")), ...(model ? { model } : {}) };
  } catch { return { status: "invalid", error: "This saved look is invalid or uses an unsupported version. Choose the affected pieces again." }; }
}

/** Resolve against today's catalog. Missing products need an explicit repair. */
export function resolveLookSelection(view: CostumeView, input: Pick<LookSelection, "selection" | "ownedPieceIds" | "skippedPieceIds"> & { legacyProductIds?: string[] }) {
  const chosen: Record<string, number> = {}, uses: Record<string, "buy" | "owned" | "skip"> = {}, issues: string[] = [];
  const known = new Set(view.pieces.map(row => row.piece.id));
  for (const pieceId of [...input.selection.map(row => row.pieceId), ...input.ownedPieceIds, ...input.skippedPieceIds]) {
    if (!known.has(pieceId)) issues.push("A saved piece is no longer in this look.");
  }
  const remaining = new Set(input.legacyProductIds ?? []);
  for (const { piece, options } of view.pieces) {
    const use = input.ownedPieceIds.includes(piece.id) ? "owned" : input.skippedPieceIds.includes(piece.id) ? "skip" : "buy";
    uses[piece.id] = use === "skip" && piece.required ? "buy" : use;
    if (use === "skip" && piece.required) issues.push(`${piece.name} is required. Choose a product or mark it owned.`);
    if (uses[piece.id] !== "buy") continue;
    const selected = input.selection.find(row => row.pieceId === piece.id)?.productId;
    const index = options.findIndex(({ product }) => selected ? product.id === selected : remaining.has(product.id));
    if (index >= 0 && options[index].product.availability !== "out_of_stock") {
      chosen[piece.id] = index; remaining.delete(options[index].product.id);
    } else if (selected || input.selection.length > 0) issues.push(`${piece.name} needs an available product.`);
  }
  if (remaining.size) issues.push("A saved product is no longer available in this look.");
  return { chosen, uses, issues: [...new Set(issues)] };
}

export interface LocalLook { snapshot: LookSelection; sizes: Record<string, string | null> }
const localKey = (slug: string) => `halloween-supply-look-v1:${slug}`;
const localSchema = z.object({ snapshot: lookSelectionSchema, sizes: z.record(id, z.string().max(120).nullable()).refine(value => Object.keys(value).length <= 60) }).strict();
export function readLocalLook(slug: string): LocalLook | null {
  try { const value = localSchema.parse(JSON.parse(localStorage.getItem(localKey(slug)) ?? "null")); return value.snapshot.costumeSlug === slug ? value : null; }
  catch { return null; }
}
/** Sizes stay in browser storage and are never part of the public snapshot. */
export function saveLocalLook(snapshot: LookSelection, sizes: Record<string, string | null> = {}): boolean {
  try { const value = localSchema.parse({ snapshot, sizes }); localStorage.setItem(localKey(snapshot.costumeSlug), JSON.stringify(value)); return true; }
  catch { return false; }
}
export function removeLocalLook(slug: string) { try { localStorage.removeItem(localKey(slug)); } catch { /* Browser storage can be unavailable. */ } }
