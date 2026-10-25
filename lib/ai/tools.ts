import "server-only";

import { tool } from "ai";
import { z } from "zod";
import * as catalog from "../catalog";
import { toCard } from "./cards";
import { clientTools } from "./client-tools";
import type { CostumeView } from "../types";
import type { PieceUse } from "../outfits";
import { outfitRequestSchema, StylistError } from "../stylist/contracts";
import { styleOutfit } from "../stylist/decide";
import type { ChatContext } from "./chat-context";

let activeStylistCalls = 0;

/** Server tools: thin wrappers over lib/catalog.ts, so every answer comes from the catalog. */
export function createTools(view: CostumeView, context?: ChatContext) {
  const costumeSlug = view.costume.slug;
  const options = view.pieces.flatMap((piece) => piece.options);
  const pieceIds = new Set(view.pieces.map(({ piece }) => piece.id));
  const productIds = new Set(options.map(({ product }) => product.id));
  const merchantIds = new Set(options.map(({ merchant }) => merchant.id));
  const id = z.string().min(1).max(150);
  let stylingCalls = 0;

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
        "Products for one piece, cheapest first. Use localOnly for Bay Area shops and maxPriceCents (US cents, inclusive) for that single piece's budget. Use assembleOutfit for a total costume budget. The shopper sees these as product cards.",
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
    assembleOutfit: tool({
      description: "Choose a complete, visually coherent costume within one TOTAL pieces budget, using Decisions to compare every valid catalog combination and actual merchant photos. Budget is integer US cents, before shipping and tax. Use this for whole-costume budget requests instead of applying the same cap separately to each piece. This returns recommendations only and never changes the cart or selections. At most one styling comparison per chat request.",
      inputSchema: z.object({
        budgetCents: z.number().int().nonnegative().max(99_999_999).describe("The shopper's total budget for all pieces to buy, in US cents."),
        notes: outfitRequestSchema.shape.brief.shape.notes,
        eventDate: outfitRequestSchema.shape.brief.shape.eventDate.optional(),
        preference: outfitRequestSchema.shape.brief.shape.preference.optional(),
        sizes: outfitRequestSchema.shape.brief.shape.sizes.optional(),
        pieceSizes: outfitRequestSchema.shape.brief.shape.pieceSizes.describe("Exact merchant size labels for particular pieces. A piece-specific label wins over that garment kind's general size."),
        ownedPieceIds: z.array(id).max(20).optional().describe("Only pieces the shopper explicitly says they own; each ID must belong to the current costume."),
        skippedPieceIds: z.array(id).max(20).optional().describe("Optional pieces the shopper explicitly wants to omit. Required pieces cannot be skipped."),
      }).strict(),
      execute: async ({ budgetCents, notes, eventDate, preference, sizes, pieceSizes, ownedPieceIds = [], skippedPieceIds = [] }, { abortSignal }) => {
        const changedPieces = [...ownedPieceIds, ...skippedPieceIds];
        if (changedPieces.some((pieceId) => !pieceIds.has(pieceId)) || new Set(changedPieces).size !== changedPieces.length) return { error: "Choose owned and skipped pieces once each from this costume.", code: "invalid_request", products: [] };
        if (stylingCalls >= 1 || activeStylistCalls >= 4) return { error: "The personal stylist is busy. Send a new message to compare another budget.", code: "busy", products: [] };
        const uses: Record<string, PieceUse> = Object.fromEntries([
          ...ownedPieceIds.map((pieceId) => [pieceId, "owned"] as const),
          ...skippedPieceIds.map((pieceId) => [pieceId, "skip"] as const),
        ]);
        const parsed = outfitRequestSchema.safeParse({
          costumeSlug,
          brief: {
            budget: (budgetCents / 100).toFixed(2), eventDate: eventDate ?? "", preference: preference ?? "styling",
            sizes: { ...(context?.sizes ?? {}), ...sizes }, pieceSizes: { ...(context?.pieceSizes ?? {}), ...pieceSizes },
            ...(notes ? { notes } : {}),
          },
          uses,
        });
        if (!parsed.success) return { error: "The styling budget, sizes, or preferences are invalid.", code: "invalid_request", products: [] };
        stylingCalls++; activeStylistCalls++;
        try {
          const result = await styleOutfit(view, parsed.data, abortSignal);
          return {
            method: result.method, products: result.plan.lines.flatMap((line) => line.option ? [toCard(line.option)] : []),
            totalCents: result.plan.total, budgetCents, explanation: result.plan.explanation, evidence: result.evidence,
            candidatesCompared: result.candidatesCompared,
            ownedPieceIds, skippedPieceIds,
            cartChanged: false,
          };
        } catch (error) {
          if (error instanceof StylistError) return { error: error.message, code: error.code, ...error.details, budgetCents, products: [], cartChanged: false };
          return { error: error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)
            ? "The personal stylist took too long. Please try again later."
            : "The personal stylist could not finish. Please try again later.", code: "provider_unavailable", products: [], cartChanged: false };
        } finally { activeStylistCalls--; }
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
      description: "The catalog evidence behind why a product was picked for a piece (local, cheapest, merchant, tags).",
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
