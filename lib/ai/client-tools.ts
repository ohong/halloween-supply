import { tool } from "ai";
import { z } from "zod";

// Client tools: declared without `execute`, so the model's call is forwarded to the
// browser, handled in components/assistant/panel.tsx and answered with addToolOutput.

export const sizeKindSchema = z.enum(["apparel", "pants", "shoe", "hat"]);

export const recordSizesSchema = z.object({
  sizes: z
    .array(z.object({ sizeKind: sizeKindSchema, size: z.string().trim().min(1).max(80).describe("As the shopper said it, including any stated sizing system, e.g. 'M', '32x32', 'US men 10.5', '7 1/4'") }).strict())
    .min(1).max(4)
    .refine((entries) => new Set(entries.map((entry) => entry.sizeKind)).size === entries.length, "Give each size kind once."),
}).strict();
export const addToCartSchema = z.object({
  pieceId: z.string().min(1).max(150).describe("Piece id from getCostume"),
  productId: z.string().min(1).max(150).describe("Product id from a catalog tool result"),
}).strict();

export const clientTools = {
  recordSizes: tool({
    description:
      "Save the shopper's sizes. Call it as soon as the shopper states any size. One entry per size kind (apparel, pants, shoe, hat). Updates cart lines of that kind and is remembered for later adds.",
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
