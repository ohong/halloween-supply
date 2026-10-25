import { z } from "zod";
import type { CartItem } from "../types";
import type { CustomLook } from "./types";

export const customPieceSchema = z.object({
  name: z.string().trim().min(1).max(60),
  slot: z.enum(["head", "top", "outer", "bottom", "feet", "accessory"]),
  query: z.string().trim().min(3).max(90),
  sizeKind: z.enum(["apparel", "pants", "shoe", "hat", "one_size"]),
});

const httpsUrl = z.url().max(2000).refine((value) => value.startsWith("https://"));
const itemSchema = z.object({
  pieceId: z.string().min(1).max(150),
  pieceName: z.string().min(1).max(60),
  sizeKind: customPieceSchema.shape.sizeKind,
  productId: z.string().regex(/^[a-f0-9]{24}$/),
  title: z.string().min(1).max(200),
  productUrl: httpsUrl,
  image: httpsUrl,
  merchantId: z.string().min(1).max(253),
  merchantName: z.string().min(1).max(253),
  priceCents: z.number().int().positive().max(99_999_999),
  availableSizes: z.array(z.string().min(1).max(120)).max(100),
  size: z.string().max(120).nullable(),
});

const customLookSchema = z.object({
  id: z.uuid(),
  query: z.string().min(3).max(160),
  model: z.enum(["male", "female"]),
  name: z.string().min(1).max(160),
  summary: z.string().max(240),
  state: z.enum(["running", "complete", "partial", "failed"]),
  pieces: z.array(z.object({ piece: customPieceSchema, item: itemSchema.nullable() })).max(7),
  createdAt: z.iso.datetime(),
  error: z.string().max(300).optional(),
});

export function validateCustomItem(value: unknown): CartItem {
  return itemSchema.parse(value);
}

export function validateCustomLook(value: unknown): CustomLook {
  const look = customLookSchema.parse(value);
  const found = look.pieces.filter(({ item }) => item !== null).length;
  if ((look.state === "complete" && (!found || found !== look.pieces.length)) ||
    (look.state === "partial" && (!found || found === look.pieces.length))) {
    throw new Error("Invalid custom look completion state.");
  }
  const items = look.pieces.flatMap(({ piece, item }) => {
    if (item && (item.pieceName !== piece.name || item.sizeKind !== piece.sizeKind)) throw new Error("A custom product does not match its component.");
    return item ? [item] : [];
  });
  if (new Set(items.map((item) => item.productId)).size !== items.length ||
    new Set(items.map((item) => item.pieceId)).size !== items.length) throw new Error("A custom product cannot be charged twice in one look.");
  return look;
}
