import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { getAlternatives, getCostume, getMerchantCatalog, getPickPath } from "../catalog";
import type { ProductOption } from "../types";
import { clientTools } from "./client-tools";

/** Compact, data-only view of a product for the model. */
export function compactOption(o: ProductOption) {
  return {
    pieceId: o.pick.pieceId,
    productId: o.product.id,
    title: o.product.title,
    merchant: { id: o.merchant.id, name: o.merchant.name, kind: o.merchant.kind },
    priceCents: o.product.priceCents,
    price: `$${(o.product.priceCents / 100).toFixed(2)}`,
    isLocal: o.pick.isLocal,
    neighborhood: o.neighborhood ? `${o.neighborhood.name}, ${o.neighborhood.city}` : null,
    tags: o.tags.map((t) => t.slug),
    url: o.product.url,
    image: o.product.image,
    description: o.product.description,
    sizes: o.product.sizes,
    availability: o.product.availability,
    rank: o.pick.rank,
    reason: o.pick.reason,
  };
}

export function createServerTools(costumeSlug: string) {
  return {
    getCostumePieces: tool({
      description: "List this costume's pieces, each with its default pick and two alternatives. Call first when you need ids.",
      inputSchema: z.object({}),
      execute: async () => {
        const view = await getCostume(costumeSlug);
        if (!view) return { error: "Costume not found" };
        return {
          costume: view.costume.name,
          pieces: view.pieces.map((p) => ({
            pieceId: p.piece.id,
            name: p.piece.name,
            sizeKind: p.piece.sizeKind,
            options: p.options.map(compactOption),
          })),
        };
      },
    }),
    findAlternatives: tool({
      description: "Other catalog products for one piece, cheapest first. Use for cheaper, local-only or different options.",
      inputSchema: z.object({
        pieceId: z.string(),
        localOnly: z.boolean().optional().describe("Only Bay Area (support-local) merchants"),
        maxPriceDollars: z.number().positive().optional().describe("Inclusive price ceiling in US dollars"),
      }),
      execute: async ({ pieceId, localOnly, maxPriceDollars }) => {
        const options = await getAlternatives(pieceId, {
          localOnly,
          maxPriceCents: maxPriceDollars === undefined ? undefined : Math.round(maxPriceDollars * 100),
          costumeSlug,
        });
        return { pieceId, count: options.length, options: options.map(compactOption) };
      },
    }),
    whatElseDoesShopSell: tool({
      description: "Other catalog products from one merchant that match this costume's pieces.",
      inputSchema: z.object({ merchantId: z.string() }),
      execute: async ({ merchantId }) => {
        const options = await getMerchantCatalog(merchantId, costumeSlug);
        return { merchantId, count: options.length, options: options.map(compactOption) };
      },
    }),
    explainPick: tool({
      description: "The graph path and written reason behind why a product was picked for a piece.",
      inputSchema: z.object({ pieceId: z.string(), productId: z.string() }),
      execute: async ({ pieceId, productId }) => {
        const pick = await getPickPath(productId, pieceId);
        if (!pick) return { error: "No such pick" };
        return {
          pieceId,
          productId,
          rank: pick.rank,
          reason: pick.reason,
          path: pick.path.map((s) => `${s.kind}: ${s.label}`),
          isLocal: pick.isLocal,
          isCheapest: pick.isCheapest,
        };
      },
    }),
  };
}

export function createTools(costumeSlug: string) {
  return { ...createServerTools(costumeSlug), ...clientTools };
}

export type ChatTools = ReturnType<typeof createTools>;
