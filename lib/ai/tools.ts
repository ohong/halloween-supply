import "server-only";

import { tool } from "ai";
import { z } from "zod";
import * as catalog from "../catalog";
import { toCard } from "./cards";
import { clientTools } from "./client-tools";
import type { CostumeView } from "../types";

/** Server tools: thin wrappers over lib/catalog.ts, so every answer comes from the catalog. */
export function createTools(view: CostumeView) {
  const costumeSlug = view.costume.slug;
  const options = view.pieces.flatMap((piece) => piece.options);
  const pieceIds = new Set(view.pieces.map(({ piece }) => piece.id));
  const productIds = new Set(options.map(({ product }) => product.id));
  const merchantIds = new Set(options.map(({ merchant }) => merchant.id));
  const id = z.string().min(1).max(150);

  return {
    getCostume: tool({
      description: "The costume with each piece and its default pick plus two alternatives (rank 0 = default).",
      inputSchema: z.object({}),
      execute: async () => {
        return {
          costume: view.costume.name,
          pieces: view.pieces.map((p) => ({
            pieceId: p.piece.id,
            name: p.piece.name,
            required: p.piece.required,
            sizeKind: p.piece.sizeKind,
            options: p.options.map(toCard),
          })),
        };
      },
    }),
    getAlternatives: tool({
      description:
        "Products for one piece, cheapest first. Use localOnly for Bay Area shops and maxPriceCents (US cents, inclusive) for a budget. The shopper sees these as product cards.",
      inputSchema: z.object({
        pieceId: id,
        localOnly: z.boolean().optional(),
        maxPriceCents: z.number().int().nonnegative().max(1000000).optional(),
      }),
      execute: async ({ pieceId, localOnly, maxPriceCents }) => {
        if (!pieceIds.has(pieceId)) return { error: "That piece is not in this costume.", pieceId, products: [] };
        const options = await catalog.getAlternatives(pieceId, { localOnly, maxPriceCents, costumeSlug });
        return { pieceId, products: options.map(toCard) };
      },
    }),
    getMerchantCatalog: tool({
      description: "Every product from one merchant that matches a piece of this costume. The shopper sees these as product cards.",
      inputSchema: z.object({ merchantId: id }),
      execute: async ({ merchantId }) => {
        if (!merchantIds.has(merchantId)) return { error: "That shop is not in this costume.", merchantId, products: [] };
        return { merchantId, products: (await catalog.getMerchantCatalog(merchantId, costumeSlug)).map(toCard) };
      },
    }),
    getFewestShops: tool({
      description:
        "Given product ids (the cart), find merchants that carry more than one of the pieces so the order can use fewer shops.",
      inputSchema: z.object({ productIds: z.array(id).min(1).max(24) }),
      execute: async ({ productIds: selected }) => {
        if (selected.some((productId) => !productIds.has(productId))) return { error: "A selected product is outside this costume.", shops: [] };
        const shared = await catalog.getFewestShops([...new Set(selected)]);
        return { shops: shared.map((s) => ({
          merchantId: s.merchant.id,
          merchant: s.merchant.name,
          products: options.filter((option) => s.productIds.includes(option.product.id)).map(toCard),
        })) };
      },
    }),
    getPickPath: tool({
      description: "The graph path behind why a product was picked for a piece (local, cheapest, merchant, tags).",
      inputSchema: z.object({ productId: id, pieceId: id }),
      execute: async ({ productId, pieceId }) => {
        if (!options.some((option) => option.product.id === productId && option.pick.pieceId === pieceId)) return { error: "That product does not match this piece." };
        const pick = await catalog.getPickPath(productId, pieceId);
        return pick
          ? { productId, pieceId, rank: pick.rank, reason: pick.reason, path: pick.path.map((s) => s.label), isLocal: pick.isLocal, isCheapest: pick.isCheapest }
          : { error: "No pick path for that product and piece." };
      },
    }),
    ...clientTools,
  };
}
