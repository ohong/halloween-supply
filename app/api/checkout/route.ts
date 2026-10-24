import type Stripe from "stripe";
import { getCostume } from "@/lib/catalog";
import { getStripe } from "@/lib/checkout/stripe";
import type { CheckoutRequest, CheckoutResponse, PriceChange } from "@/lib/checkout/types";
import { verifyProduct } from "@/lib/checkout/verify";
import type { ProductOption, PieceView } from "@/lib/types";

export const maxDuration = 60;

const reply = (body: CheckoutResponse, status = 200) => Response.json(body, { status });
const fail = (message: string, status = 400) => reply({ status: "error", message }, status);
const clip = (s: string, n = 500) => (s.length > n ? s.slice(0, n) : s);

function parseBody(raw: unknown): CheckoutRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.costumeSlug !== "string" || !Array.isArray(b.items) || b.items.length === 0) return null;
  const items: CheckoutRequest["items"] = [];
  for (const it of b.items) {
    if (typeof it !== "object" || it === null) return null;
    const r = it as Record<string, unknown>;
    if (typeof r.pieceId !== "string" || typeof r.productId !== "string") return null;
    if (r.size !== null && typeof r.size !== "string") return null;
    items.push({ pieceId: r.pieceId, productId: r.productId, size: (r.size as string | null)?.trim() || null });
  }
  return { costumeSlug: b.costumeSlug, items };
}

export async function POST(request: Request) {
  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return fail("Request body must be JSON.");
    }
    const body = parseBody(raw);
    if (!body) return fail("Invalid checkout request.");

    const costume = await getCostume(body.costumeSlug);
    if (!costume) return fail(`Unknown costume "${body.costumeSlug}".`, 404);

    // Resolve each item against the catalog; the client never supplies prices.
    const lines: { pv: PieceView; option: ProductOption; size: string | null }[] = [];
    const seen = new Set<string>();
    for (const item of body.items) {
      const pv = costume.pieces.find((p) => p.piece.id === item.pieceId);
      if (!pv) return fail(`Piece "${item.pieceId}" is not part of ${costume.costume.name}.`);
      const option = pv.options.find((o) => o.product.id === item.productId);
      if (!option) return fail(`Product "${item.productId}" is not an option for ${pv.piece.name}.`);
      if (seen.has(pv.piece.id)) return fail(`Piece "${pv.piece.name}" appears twice in the cart.`);
      seen.add(pv.piece.id);
      lines.push({ pv, option, size: item.size });
    }

    const missing = lines.filter((l) => l.pv.piece.sizeKind !== "one_size" && !l.size).map((l) => l.pv.piece.id);
    if (missing.length) {
      const names = lines.filter((l) => missing.includes(l.pv.piece.id)).map((l) => l.pv.piece.name);
      return reply({ status: "needs_sizes", pieceIds: missing, message: `Sizes are still needed for: ${names.join(", ")}.` });
    }

    // Live re-check, all products in parallel.
    const checks = await Promise.all(lines.map((l) => verifyProduct(l.option.product)));

    for (let i = 0; i < lines.length; i++) {
      const c = checks[i];
      if (c.verified && c.availability === "out_of_stock") {
        const { piece } = lines[i].pv;
        return reply({
          status: "sold_out",
          pieceId: piece.id,
          pieceName: piece.name,
          message: `${lines[i].option.product.title} just sold out at ${lines[i].option.merchant.name}. Pick another ${piece.name.toLowerCase()} to continue.`,
        });
      }
    }

    const origin = new URL(request.url).origin;
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(origin).hostname);
    const priceChanges: PriceChange[] = [];

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    const metadata: Record<string, string> = { costume: costume.costume.slug };

    lines.forEach((l, i) => {
      const c = checks[i];
      const p = l.option.product;
      const unverified = !c.verified;
      const cents = c.verified ? c.priceCents : p.priceCents;
      if (c.verified && c.priceCents !== p.priceCents) {
        priceChanges.push({ pieceId: l.pv.piece.id, pieceName: l.pv.piece.name, oldCents: p.priceCents, newCents: c.priceCents });
      }

      let image: string | null = null;
      try {
        const abs = new URL(p.image, origin);
        if (abs.protocol === "https:" || (!isLocal && abs.protocol === "http:")) {
          // Local /public paths resolve against the origin; skip them when the origin is localhost.
          if (!(isLocal && abs.origin === origin)) image = abs.toString();
        }
      } catch {
        image = null;
      }

      lineItems.push({
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: cents,
          product_data: {
            name: clip(`${l.pv.piece.name}: ${p.title}`, 250),
            ...(image ? { images: [image] } : {}),
            metadata: {
              merchant: clip(l.option.merchant.name),
              merchant_id: l.option.merchant.id,
              product_url: clip(p.url),
              piece_id: l.pv.piece.id,
              size: l.size ?? "one size",
              price_unverified: String(unverified),
            },
          },
        },
      });

      metadata[`item_${i + 1}`] = clip(
        JSON.stringify({ piece: l.pv.piece.id, merchant: l.option.merchant.name, url: p.url, size: l.size ?? "one size", cents, unverified }),
      );
    });

    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      shipping_address_collection: { allowed_countries: ["US"] },
      metadata,
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/costumes/${costume.costume.slug}`,
    });
    if (!session.url) throw new Error("Stripe returned a session without a URL.");

    return reply({ status: "ok", url: session.url, sessionId: session.id, priceChanges });
  } catch (e) {
    console.error("[checkout] failed", e);
    return fail(e instanceof Error ? e.message : "Checkout failed.", 500);
  }
}
