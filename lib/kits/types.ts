import type { Merchant, Product, SnapshotPiece } from "../types";

export type KitDeliveryStatus = "delivery_unconfirmed" | "known_too_late" | "pickup_option_found";

/** Evidence records facts; they never turn processing time into an arrival promise. */
export interface KitEvidence {
  url: string;
  checkedAt: string;
  kind: "product" | "shipping" | "pickup" | "assembly";
  note: string;
  productId?: string;
  /** Use only when a published source establishes an absolute earliest arrival date. */
  earliestArrivalDate?: string;
}

/** An overlay on an existing catalog. Every piece has one explicit disposition. */
export interface KitDefinition {
  slug: string;
  costumeSlug: string;
  name: string;
  description: string;
  /** The existing cart stores one item per piece. Multi-quantity kits are unsupported. */
  buy: { pieceId: string; productId: string; quantity?: 1 }[];
  owned: { pieceId: string; note: string }[];
  /** Explicit owned basics outside this costume's catalog, such as underwear or shoes. */
  ownedExtras?: string[];
  skipped: { pieceId: string; reason: string }[];
  extraSupplies: string[];
  assembly: { minutes: number; steps: string[]; tools: string[] };
  readiness: { notes: string[]; evidence: KitEvidence[] };
  rationale: string;
}

export interface KitOptions {
  /** Local event date, independent of Halloween or the current year. */
  eventDate?: string;
}

export interface CostumePriceSummary {
  costumeSlug: string;
  /** Minimum available merchant listing for each required piece. */
  requiredSubtotalCents: number | null;
  /** Minimum available merchant listing for every piece, including optional pieces. */
  fullSubtotalCents: number | null;
  /** Existing rank-zero selection for every piece. */
  defaultSubtotalCents: number | null;
  unknownStockCount: number;
  unavailablePieceCount: number;
}

export interface KitSummary {
  slug: string;
  costumeSlug: string;
  name: string;
  description: string;
  image: string;
  alt: string;
  purchaseSubtotalCents: number;
  fullSubtotalCents: number | null;
  defaultSubtotalCents: number | null;
  savingsCents: number | null;
  purchaseCount: number;
  ownedCount: number;
  skippedCount: number;
  shopCount: number;
  unknownStockCount: number;
  outOfStockCount: number;
  oldestCheckedAt: string | null;
  assemblyMinutes: number;
  ownedBasics: string[];
  supplies: string[];
  deliveryStatus: KitDeliveryStatus;
  pickupItemCount: number;
  /** Unknown delivery remains visible, but does not assert that the kit is too late. */
  eligible: boolean;
}

export interface KitView extends KitSummary {
  definition: KitDefinition;
  buy: { piece: SnapshotPiece; product: Product; merchant: Merchant; quantity: number }[];
  owned: { piece: SnapshotPiece; note: string }[];
  skipped: { piece: SnapshotPiece; reason: string }[];
  readiness: {
    status: KitDeliveryStatus;
    eventDate: string | null;
    tooLateProductIds: string[];
    pickupProductIds: string[];
    notes: string[];
    evidence: KitEvidence[];
  };
}

export type KitSelection =
  | { pieceId: string; status: "selected"; productId: string }
  | { pieceId: string; status: "owned" }
  | { pieceId: string; status: "skipped" };
