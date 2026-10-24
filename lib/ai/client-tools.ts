import { tool } from "ai";
import { z } from "zod";

// Client tools: declared without `execute`, so the model's call is forwarded to the
// browser, handled in components/assistant/panel.tsx and answered with addToolOutput.

export const sizeKindSchema = z.enum(["apparel", "pants", "shoe", "hat"]);

export const recordSizesSchema = z.object({
  sizes: z
    .array(z.object({
      sizeKind: sizeKindSchema,
      pieceId: z.string().min(1).max(150).optional().describe("Include the piece id when a size belongs to one garment, especially when two garments use different merchant labels. Omit only for a general size preference."),
      size: z.string().trim().min(1).max(80).describe("As the shopper said it, including any stated sizing system or exact merchant label, e.g. 'M', '40', 'C', '32x32', 'US men 10.5', '7 1/4'"),
    }).strict())
    .min(1).max(24)
    .refine((entries) => new Set(entries.map((entry) => `${entry.sizeKind}:${entry.pieceId ?? "*"}`)).size === entries.length, "Give each piece or general size kind once."),
}).strict();
export const addToCartSchema = z.object({
  pieceId: z.string().min(1).max(150).describe("Piece id from getCostume"),
  productId: z.string().min(1).max(150).describe("Product id from a catalog tool result"),
}).strict();

export const clientTools = {
  recordSizes: tool({
    description:
      "Save the shopper's sizes as soon as they state them. Include pieceId for a particular garment; this updates only that piece and takes priority over its general size kind. Omit pieceId for a general apparel, pants, shoe or hat preference; this updates that kind and clears piece overrides in the active costume. Different garments may use different labels even when their sizeKind is the same.",
    inputSchema: recordSizesSchema,
  }),
  addToCart: tool({
    description:
      "Add a catalog product to the shopper's cart for a piece. Replaces any product already in the cart for that piece. Only call after the shopper asks for it or clearly agrees.",
    inputSchema: addToCartSchema,
  }),
};

export type RecordSizesInput = z.infer<typeof recordSizesSchema>;
export type AddToCartInput = z.infer<typeof addToCartSchema>;
