// POST /api/checkout request and response contract (cart -> Stripe Checkout).

export interface CheckoutRequest {
  costumeSlug: string;
  items: { pieceId: string; productId: string; size: string | null }[];
}

export interface PriceChange {
  pieceId: string;
  pieceName: string;
  oldCents: number;
  newCents: number;
}

export type CheckoutResponse =
  /** Session created. priceChanges is non-empty when the re-check moved a price; show them before redirecting. */
  | { status: "ok"; url: string; sessionId: string; priceChanges: PriceChange[] }
  /** A piece sold out at the merchant; checkout is blocked until the user swaps it. */
  | { status: "sold_out"; pieceId: string; pieceName: string; message: string }
  /** Some pieces still need a size; the assistant should ask for them. */
  | { status: "needs_sizes"; pieceIds: string[]; message: string }
  | { status: "error"; message: string };
