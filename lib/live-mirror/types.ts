import type { CostumeView } from "@/lib/types";
import type { PieceUse } from "@/lib/outfits";

export type MirrorOutfit = {
  selection: Record<string, string>;
  uses: Record<string, PieceUse>;
  locked: string[];
  budget: string;
};
export type MirrorAction =
  | { type: "select"; pieceId: string; productId: string }
  | { type: "use"; pieceId: string; use: PieceUse }
  | { type: "lock"; pieceId: string; locked: boolean }
  | { type: "budget"; amount: string }
  | { type: "cheapest" }
  | { type: "undo" }
  | { type: "save" }
  | { type: "freeze" }
  | { type: "resume" };
export type MirrorCommand = { actions: MirrorAction[]; message?: string };
export type MirrorStatus = "idle" | "connecting" | "live" | "error";
export type MirrorContext = { costume: CostumeView; outfit: MirrorOutfit };
