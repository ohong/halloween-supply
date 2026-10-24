import { tool } from "ai";
import { z } from "zod";

// Tools with no `execute`: the model calls them, the browser runs them
// (useChat onToolCall + addToolOutput) and the result goes back to the model.
// This file is safe to import from client code.

export const clientTools = {
  recordSizes: tool({
    description:
      "Record the shopper's sizes on the cart lines. Call as soon as they give sizes. Only pieces already in the cart can take a size; the result says which were applied and which pieces are not in the cart yet.",
    outputSchema: z.object({
      applied: z.array(z.object({ pieceId: z.string(), size: z.string() })),
      notInCartYet: z.array(z.string()),
      unknownPieces: z.array(z.string()),
    }),
    inputSchema: z.object({
      sizes: z
        .array(z.object({ pieceId: z.string(), size: z.string().describe('e.g. "M", "7 1/4", "32x30", "10"') }))
        .min(1),
    }),
  }),
  addToCart: tool({
    description: "Put one of this costume's catalog products in the cart for its piece, replacing any earlier pick for that piece. Only on the shopper's request.",
    inputSchema: z.object({ pieceId: z.string(), productId: z.string() }),
    outputSchema: z.union([
      z.object({ added: z.literal(true), piece: z.string(), title: z.string(), merchant: z.string(), priceCents: z.number(), size: z.string().nullable() }),
      z.object({ added: z.literal(false), reason: z.string() }),
    ]),
  }),
  showProducts: tool({
    description:
      "Show product cards (image, price, merchant, Add to cart button) for a piece. Use whenever you recommend or compare products. Use ids from the catalog tools only.",
    inputSchema: z.object({ pieceId: z.string(), productIds: z.array(z.string()).min(1).max(3) }),
    outputSchema: z.string(),
  }),
};
