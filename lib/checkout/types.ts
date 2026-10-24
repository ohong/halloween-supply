// POST /api/checkout request and response contract (cart -> Stripe Checkout).

export interface CheckoutRequest {
  costumeSlug: string;
  items: { pieceId: string; productId: string; size: string | null }[];
  /** Acknowledgment only. The server still re-fetches and charges the merchant's exact live price. */
  acceptedPrices?: { pieceId: string; productId: string; priceCents: number }[];
}

export interface PriceChange {
  pieceId: string;
  pieceName: string;
  productId: string;
  oldCents: number;
  newCents: number;
}

export type CheckoutResponse =
  /** Session created only after every product, selected size, stock and price pass the live re-check. */
  | { status: "ok"; url: string; sessionId: string; priceChanges: PriceChange[] }
  /** No session exists yet. The customer must accept these amounts before retrying. */
  | { status: "price_changed"; priceChanges: PriceChange[]; message: string }
  /** A piece sold out at the merchant; checkout is blocked until the user swaps it. */
  | { status: "sold_out"; pieceId: string; pieceName: string; message: string }
  /** Some pieces still need a size; the assistant should ask for them. */
  | { status: "needs_sizes"; pieceIds: string[]; message: string }
  | { status: "invalid_size"; pieceId: string; pieceName: string; availableSizes: string[]; message: string }
  | { status: "unverified"; pieceId: string; pieceName: string; message: string }
  | { status: "error"; message: string };
