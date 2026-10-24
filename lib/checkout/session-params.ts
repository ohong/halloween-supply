import type Stripe from "stripe";

// Pure builder for the Stripe Checkout session. No fees, markup or shipping line:
// the total is the sum of merchant prices.

export interface SessionLine {
  pieceId: string;
  pieceName: string;
  productId: string;
  title: string;
  merchantId: string;
  merchantName: string;
  productUrl: string;
  /** Product image: absolute URL or a "/products/x.jpg" path. */
  image: string;
  size: string | null;
  /** Verified price (or the stored price when unverified), integer cents. */
  priceCents: number;
  priceUnverified: boolean;
}

export interface SessionInput {
  /** Site origin, no trailing slash, e.g. "https://halloween.supply". */
  origin: string;
  costumeSlug: string;
  lines: SessionLine[];
}

const META_MAX = 500;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Stripe only fetches https images. Relative paths are resolved against the origin. */
export function absoluteImageUrl(image: string, origin: string): string | null {
  try {
    const url = new URL(image, origin.endsWith("/") ? origin : origin + "/");
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function sizeLabel(size: string | null): string {
  return size && size.trim() ? size.trim() : "one size";
}

/** "merchant | url | size", clipped to Stripe's 500-char metadata value limit (the URL gives way first). */
export function lineSummary(l: SessionLine): string {
  const tail = ` | ${sizeLabel(l.size)}${l.priceUnverified ? " | price unverified" : ""}`;
  const head = `${l.merchantName} | `;
  const room = META_MAX - head.length - tail.length;
  return head + clip(l.productUrl, Math.max(room, 20)) + tail;
}

export function totalCents(lines: SessionLine[]): number {
  return lines.reduce((sum, l) => sum + l.priceCents, 0);
}

export function buildSessionParams(input: SessionInput): Stripe.Checkout.SessionCreateParams {
  const origin = input.origin.replace(/\/+$/, "");
  const metadata: Record<string, string> = { costume_slug: input.costumeSlug };
  input.lines.forEach((l, i) => {
    metadata[`line_${i + 1}`] = lineSummary(l);
  });

  return {
    mode: "payment",
    line_items: input.lines.map((l) => {
      const image = absoluteImageUrl(l.image, origin);
      return {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: l.priceCents,
          product_data: {
            name: clip(`${l.pieceName} — ${l.title}`, 250),
            description: clip(l.merchantName, 500),
            ...(image ? { images: [image] } : {}),
            metadata: {
              piece_id: l.pieceId,
              piece_name: clip(l.pieceName, META_MAX),
              product_id: l.productId,
              merchant_id: l.merchantId,
              merchant_name: clip(l.merchantName, META_MAX),
              product_url: clip(l.productUrl, META_MAX),
              size: sizeLabel(l.size),
              price_unverified: String(l.priceUnverified),
            },
          },
        },
      };
    }),
    shipping_address_collection: { allowed_countries: ["US"] },
    metadata,
    success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/costumes/${encodeURIComponent(input.costumeSlug)}`,
  };
}
