import type { CartItem, SizeKind } from "../types";

export interface CustomPiece {
  name: string;
  slot: "head" | "top" | "outer" | "bottom" | "feet" | "accessory";
  query: string;
  sizeKind: SizeKind;
}

/** Guest-created looks remain outside the reviewed editorial catalog. */
export interface CustomLook {
  id: string;
  query: string;
  model: "male" | "female";
  name: string;
  summary: string;
  state: "running" | "complete" | "partial" | "failed";
  pieces: { piece: CustomPiece; item: CartItem | null }[];
  createdAt: string;
  error?: string;
}

export type CustomLookEvent =
  | { t: "look"; name: string; summary: string; pieces: CustomPiece[] }
  | { t: "log"; text: string }
  | { t: "piece"; i: number; item: CartItem }
  | { t: "miss"; i: number }
  | { t: "done"; id: string; href: string; found: number; missing: number }
  | { t: "error"; text: string; retryWithNewRequestId?: true };
