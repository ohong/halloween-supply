// POST /api/checkout request and response contract (cart -> Stripe Checkout).

import type { Availability, CartItem, SizeKind } from "../types";

/** Cart slug for a look sourced from a screenshot rather than the catalog. */
export const SCREENSHOT_SLUG = "screenshot-look";
export const DEMO_DEFAULT_SIZE = "M";

/** Saved custom looks are separate from reviewed editorial catalog slugs. */
export function customLookId(slug: string | null): string | null {
  const match = slug?.match(/^custom-look:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match ? match[1].toLowerCase() : null;
}

export function costumePath(slug: string) {
  const id = customLookId(slug);
  return id ? `/create/${id}` : slug === SCREENSHOT_SLUG ? "/screenshot" : `/costumes/${slug}`;
}

export interface CheckoutRequest {
  costumeSlug: string;
  items: { pieceId: string; productId: string; size: string | null; web?: WebItem }[];
  /** Acknowledgment only. The server still re-fetches and charges the merchant's exact live price. */
  acceptedPrices?: { pieceId: string; productId: string; priceCents: number }[];
}

/** A screenshot-look piece found on the open web. The server re-derives its id and live price from the URL. */
export interface WebItem {
  url: string;
  title: string;
  image: string;
  merchantName: string;
  pieceName: string;
  sizeKind: SizeKind;
}

export interface PriceChange {
  pieceId: string;
  pieceName: string;
  productId: string;
  oldCents: number;
  newCents: number;
}

/** Recorded alternatives remain subject to live merchant checks at checkout. */
export interface CheckoutAlternative {
  item: CartItem;
  availability: Availability;
  checkedAt: string;
}

export interface CheckoutRecovery {
  pieceId: string;
  pieceName: string;
  productId: string;
  /** A real catalog page for this piece, including pieces mixed from another look. */
  alternativesHref: string | null;
  alternatives: CheckoutAlternative[];
  message: string;
}

export type CheckoutResponse =
  /** Live offers are re-checked; assumed demo sizes are marked in Stripe metadata. */
  | { status: "ok"; url: string; sessionId: string; priceChanges: PriceChange[] }
  /** No session exists yet. The customer must accept these amounts before retrying. */
  | { status: "price_changed"; priceChanges: PriceChange[]; message: string }
  /** A piece sold out at the merchant; checkout is blocked until the user swaps it. */
  | ({ status: "sold_out" } & CheckoutRecovery)
  /** Live-money checkout still requires explicit sizes. */
  | { status: "needs_sizes"; pieceIds: string[]; message: string }
  | ({ status: "invalid_size"; availableSizes: string[] } & CheckoutRecovery)
  | ({ status: "unverified" } & CheckoutRecovery)
  | { status: "error"; message: string };
