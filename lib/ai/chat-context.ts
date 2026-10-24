import type { SizeKind } from "../types";
import { z } from "zod";

const size = z.string().trim().min(1).max(80);

export const sizesSchema = z.object({ apparel: size.optional(), pants: size.optional(), shoe: size.optional(), hat: size.optional() }).strict();

export const chatContextSchema = z.object({
  costumeSlug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  cart: z.array(z.object({
    pieceId: z.string().min(1).max(150),
    productId: z.string().min(1).max(150),
    size: size.nullable(),
  }).strict()).max(24).default([]),
  sizes: sizesSchema.default({}),
}).strict();

/** Sent by the browser with every chat request, so the server can ground the prompt. */
export interface ChatContext {
  costumeSlug: string;
  cart: { pieceId: string; productId: string; size: string | null }[];
  sizes: Partial<Record<SizeKind, string>>;
}
