import type { Costume, CostumeView, ProductOption } from "@/lib/types";
import type { PieceUse } from "@/lib/outfits";

export type MirrorOutfit = {
  selection: Record<string, string>;
  uses: Record<string, PieceUse>;
  locked: string[];
  budget: string;
};
export type MirrorAction =
  | { type: "try_look"; costumeSlug: string; selection?: Record<string, string> }
  | { type: "select"; pieceId: string; productId: string }
  | { type: "use"; pieceId: string; use: PieceUse }
  | { type: "lock"; pieceId: string; locked: boolean }
  | { type: "budget"; amount: string }
  | { type: "cheapest" }
  | { type: "undo" }
  | { type: "save" }
  | { type: "freeze" }
  | { type: "resume" };
export type MirrorCatalogLook = Pick<Costume, "slug" | "name" | "description" | "image"> & {
  pieces: { id: string; name: string; category: string }[];
};
export type MirrorCatalogRef = { costumeSlug: string; pieceId: string; productId: string };
export type MirrorCatalogContext = { query: string; matches: MirrorCatalogRef[] };
export type MirrorCatalogMatch = MirrorCatalogRef & {
  costumeName: string; pieceName: string; option: ProductOption;
};
export type MirrorCatalogResults = {
  query: string; source: "database" | "snapshot";
  counts: { costumes: number; pieces: number; products: number };
  matches: MirrorCatalogMatch[];
};
export type MirrorCommand = { actions: MirrorAction[]; message?: string; catalogResults?: MirrorCatalogResults };
export type MirrorStatus = "idle" | "connecting" | "live" | "error";
export type MirrorContext = { costume: CostumeView; outfit: MirrorOutfit };
