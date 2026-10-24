import type Stripe from "stripe";
import { getCostume } from "@/lib/catalog";
import { getStripe } from "@/lib/checkout/stripe";
import type { CheckoutRequest, CheckoutResponse, PriceChange } from "@/lib/checkout/types";
import { verifyProduct, type Verification } from "@/lib/checkout/verify";
import type { ProductOption, PieceView } from "@/lib/types";

export const maxDuration = 60;

const reply = (body: CheckoutResponse, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (message: string, status = 400) => reply({ status: "error", message }, status);
const clip = (s: string, n = 500) => (s.length > n ? s.slice(0, n) : s);
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 150;

function parseBody(raw: unknown): CheckoutRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (!identifier(b.costumeSlug) || !Array.isArray(b.items) || b.items.length === 0 || b.items.length > 25) return null;
  const items: CheckoutRequest["items"] = [];
  for (const it of b.items) {
    if (typeof it !== "object" || it === null) return null;
    const r = it as Record<string, unknown>;
    if (!identifier(r.pieceId) || !identifier(r.productId)) return null;
    if (r.size !== null && (typeof r.size !== "string" || r.size.length > 100)) return null;
    items.push({ pieceId: r.pieceId, productId: r.productId, size: (r.size as string | null)?.trim() || null });
  }
  let acceptedPrices: CheckoutRequest["acceptedPrices"];
  if (b.acceptedPrices !== undefined) {
    if (!Array.isArray(b.acceptedPrices) || b.acceptedPrices.length > items.length) return null;
    acceptedPrices = [];
    const seen = new Set<string>();
    for (const value of b.acceptedPrices) {
      if (typeof value !== "object" || value === null) return null;
      const acknowledgment = value as Record<string, unknown>;
      if (!identifier(acknowledgment.pieceId) || !identifier(acknowledgment.productId) || !Number.isSafeInteger(acknowledgment.priceCents) || Number(acknowledgment.priceCents) <= 0) return null;
      if (seen.has(acknowledgment.pieceId) || !items.some((item) => item.pieceId === acknowledgment.pieceId && item.productId === acknowledgment.productId)) return null;
      seen.add(acknowledgment.pieceId);
      acceptedPrices.push({ pieceId: acknowledgment.pieceId, productId: acknowledgment.productId, priceCents: acknowledgment.priceCents as number });
    }
  }
  return { costumeSlug: b.costumeSlug, items, ...(acceptedPrices ? { acceptedPrices } : {}) };
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
    const requestOrigin = new URL(request.url).origin;
    const submittedOrigin = request.headers.get("origin");
    if (submittedOrigin && submittedOrigin !== requestOrigin) return fail("Checkout must start on this store.", 403);

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

    // Merchant sizes can change after sourcing. Only the live offer decides
    // whether a size is valid, including full variant titles and size aliases.
    const checks = await Promise.all(lines.map((line) => verifyProduct(line.option.product, line.pv.piece.sizeKind === "one_size" ? null : line.size)));

    for (let i = 0; i < lines.length; i++) {
      const c = checks[i];
      const { piece } = lines[i].pv;
      if (!c.verified) {
        if (c.invalidSize) return reply({ status: "invalid_size", pieceId: piece.id, pieceName: piece.name, availableSizes: c.availableSizes ?? [], message: `The merchant no longer offers that size for ${piece.name.toLowerCase()}. Ask the assistant for another size or pick.` });
        return reply({ status: "unverified", pieceId: piece.id, pieceName: piece.name, message: `We could not confirm the live price and stock for ${lines[i].option.product.title}. Try again or swap this piece.` }, 503);
      }
      if (c.verified && c.availability === "out_of_stock") {
        return reply({
          status: "sold_out",
          pieceId: piece.id,
          pieceName: piece.name,
          message: `${lines[i].option.product.title} just sold out at ${lines[i].option.merchant.name}. Pick another ${piece.name.toLowerCase()} to continue.`,
        });
      }
      if (c.availability !== "in_stock") return reply({ status: "unverified", pieceId: piece.id, pieceName: piece.name, message: `The merchant has not confirmed stock for ${lines[i].option.product.title}. Pick another ${piece.name.toLowerCase()} to continue.` }, 503);
    }

    const verified = checks as Extract<Verification, { verified: true }>[];
    const origin = requestOrigin;
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(origin).hostname);
    const priceChanges: PriceChange[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const expected = body.acceptedPrices?.find((value) => value.pieceId === line.pv.piece.id && value.productId === line.option.product.id)?.priceCents ?? line.option.product.priceCents;
      if (verified[i].priceCents !== expected) priceChanges.push({ pieceId: line.pv.piece.id, pieceName: line.pv.piece.name, productId: line.option.product.id, oldCents: expected, newCents: verified[i].priceCents });
    }
    if (priceChanges.length) return reply({ status: "price_changed", priceChanges, message: "The merchant prices changed. Review and accept the new prices before continuing." });

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    const metadata: Record<string, string> = { costume: costume.costume.slug };

    lines.forEach((l, i) => {
      const c = verified[i];
      const p = l.option.product;
      const cents = c.priceCents;

      let image: string | null = null;
      try {
        const abs = new URL(p.image, origin);
        if (abs.protocol === "https:") {
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
            description: clip(`From ${l.option.merchant.name}${l.size ? ` · Size ${l.size}` : ""}`),
            ...(image ? { images: [image] } : {}),
            metadata: {
              merchant: clip(l.option.merchant.name),
              merchant_id: l.option.merchant.id,
              product_id: p.id,
              product_url: clip(c.productUrl),
              piece_id: l.pv.piece.id,
              size: l.size ?? "one size",
              ...(c.variantId ? { variant_id: c.variantId } : {}),
              verified_at: c.checkedAt,
            },
          },
        },
      });

      metadata[`item_${i + 1}`] = clip(
        JSON.stringify({ piece: l.pv.piece.id, merchant: l.option.merchant.name, url: c.productUrl, size: l.size ?? "one size", cents }),
      );
    });

    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      adaptive_pricing: { enabled: false },
      automatic_tax: { enabled: false },
      customer_creation: "if_required",
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      shipping_address_collection: { allowed_countries: ["US"] },
      metadata,
      payment_intent_data: { metadata },
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/costumes/${costume.costume.slug}`,
    });
    if (!session.url) throw new Error("Stripe returned a session without a URL.");

    return reply({ status: "ok", url: session.url, sessionId: session.id, priceChanges });
  } catch (e) {
    console.error("[checkout] session creation failed", e instanceof Error ? e.name : "UnknownError");
    return fail("Checkout could not start. Please try again.", 500);
  }
}
