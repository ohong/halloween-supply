import { z } from "zod";
import type { OutfitPlan } from "@/lib/outfits";
import type { PriceTier } from "@/lib/types";

const identifier = z.string().min(1).max(150).regex(/^[a-zA-Z0-9_-]+$/);
const sizeKind = z.enum(["apparel", "pants", "shoe", "hat", "one_size"]);
export const outfitRequestSchema = z.object({
  costumeSlug: identifier,
  brief: z.object({
    budget: z.string().trim().max(12).refine((value) => value === "" || /^\d{1,6}(?:\.\d{1,2})?$/.test(value), "Use a dollar amount with at most two decimal places."),
    eventDate: z.string().max(10).refine((value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "Use a valid event date."),
    preference: z.enum(["styling", "local", "secondhand"]),
    sizes: z.partialRecord(sizeKind, z.string().trim().max(80)),
    pieceSizes: z.record(identifier, z.string().trim().max(40)).refine((value) => Object.keys(value).length <= 20).optional(),
    notes: z.string().trim().max(500).optional(),
  }).strict(),
  uses: z.record(identifier, z.enum(["buy", "owned", "skip"])).refine((value) => Object.keys(value).length <= 20),
}).strict();

export type OutfitRequest = z.infer<typeof outfitRequestSchema>;
export type StylistResult = {
  plan: OutfitPlan;
  method: "decisions";
  candidatesCompared: number;
  feasibleOutfits: number;
  evidence: {
    minimumSubtotal: number;
    budgetCents: number | null;
    remainingBudget: number | null;
    preferredItems: number;
    unknownStockPieces: string[];
    unknownSizePieces: string[];
    /** An event date is context, never a verified delivery promise. */
    deliveryConfirmed: false;
    inspirationPhotoIncluded: true;
    photoProductIds: string[];
    textOnlyProductIds: string[];
    selected: {
      pieceId: string;
      productId: string;
      priceCents: number;
      priceTier: PriceTier;
      stylingNote: string;
    }[];
  };
};

export type StylistErrorCode = "invalid_request" | "budget_too_low" | "no_feasible_outfit" | "review_needed" | "provider_unavailable" | "busy";

export class StylistError extends Error {
  constructor(public status: number, message: string, public code: StylistErrorCode, public details: Record<string, unknown> = {}) {
    super(message);
  }
}
