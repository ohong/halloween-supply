import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { getCostume } from "@/lib/catalog";
import { getStripe } from "@/lib/checkout/stripe";
import { SCREENSHOT_SLUG, type CheckoutRequest, type CheckoutResponse, type PriceChange, type WebItem } from "@/lib/checkout/types";
import { verifyProduct, type Verification } from "@/lib/checkout/verify";
import { isBlockedDomain, isNoiseDomain, registrableDomain } from "@/lib/sourcing/blocklist";
import type { SizeKind } from "@/lib/types";

export const maxDuration = 60;

const reply = (body: CheckoutResponse, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (message: string, status = 400) => reply({ status: "error", message }, status);
const clip = (s: string, n = 500) => (s.length > n ? s.slice(0, n) : s);
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 150;
const SIZE_KINDS: SizeKind[] = ["apparel", "pants", "shoe", "hat", "one_size"];
const webProductId = (url: string) => createHash("sha256").update(url).digest("hex").slice(0, 24);

/** One resolved cart line, whether it came from the catalog or from a screenshot look. */
interface Line {
  pieceId: string;
  pieceName: string;
  sizeKind: SizeKind;
  product: { id: string; url: string; currency: "USD"; title: string; image: string; priceCents: number | null };
  merchant: { id: string; name: string };
  size: string | null;
}

function parseWeb(value: unknown): WebItem | null {
  if (typeof value !== "object" || value === null) return null;
  const w = value as Record<string, unknown>;
  const short = (v: unknown, n: number) => typeof v === "string" && v.length > 0 && v.length <= n;
  if (!short(w.url, 2000) || !short(w.title, 300) || !short(w.image, 2000) || !short(w.merchantName, 150) || !short(w.pieceName, 150) || !SIZE_KINDS.includes(w.sizeKind as SizeKind)) return null;
  try { if (new URL(w.url as string).protocol !== "https:") return null; } catch { return null; }
  return { url: w.url as string, title: w.title as string, image: w.image as string, merchantName: w.merchantName as string, pieceName: w.pieceName as string, sizeKind: w.sizeKind as SizeKind };
}

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
    const web = r.web === undefined ? undefined : parseWeb(r.web);
    if (web === null) return null;
    items.push({ pieceId: r.pieceId, productId: r.productId, size: (r.size as string | null)?.trim() || null, ...(web ? { web } : {}) });
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

    const lines: Line[] = [];
    const seen = new Set<string>();
    let costumeSlug: string;
    let cancelPath: string;
    if (body.costumeSlug === SCREENSHOT_SLUG) {
      // Pieces found on the open web: nothing to look up, so every claim is re-checked against the merchant below.
      costumeSlug = SCREENSHOT_SLUG;
      cancelPath = "/screenshot";
      for (const item of body.items) {
        const web = item.web;
        if (!web) return fail(`Piece "${item.pieceId}" is missing its product details.`);
        if (isBlockedDomain(web.url) || isNoiseDomain(web.url)) return fail(`${web.pieceName} comes from a shop we can't check out.`);
        if (webProductId(web.url) !== item.productId) return fail(`Product "${item.productId}" does not match its link.`);
        if (seen.has(item.pieceId)) return fail(`Piece "${web.pieceName}" appears twice in the cart.`);
        seen.add(item.pieceId);
        const host = new URL(web.url).hostname;
        const merchant = registrableDomain(host) ?? host;
        lines.push({
          pieceId: item.pieceId, pieceName: web.pieceName, sizeKind: web.sizeKind, size: item.size,
          product: { id: item.productId, url: web.url, currency: "USD", title: web.title, image: web.image, priceCents: null },
          merchant: { id: merchant, name: merchant },
        });
      }
    } else {
      const costume = await getCostume(body.costumeSlug);
      if (!costume) return fail(`Unknown costume "${body.costumeSlug}".`, 404);
      costumeSlug = costume.costume.slug;
      cancelPath = `/costumes/${costume.costume.slug}`;
      // Resolve each item against the catalog; the client never supplies prices.
      for (const item of body.items) {
        const pv = costume.pieces.find((p) => p.piece.id === item.pieceId);
        if (!pv) return fail(`Piece "${item.pieceId}" is not part of ${costume.costume.name}.`);
        const option = pv.options.find((o) => o.product.id === item.productId);
        if (!option) return fail(`Product "${item.productId}" is not an option for ${pv.piece.name}.`);
        if (seen.has(pv.piece.id)) return fail(`Piece "${pv.piece.name}" appears twice in the cart.`);
        seen.add(pv.piece.id);
        lines.push({
          pieceId: pv.piece.id, pieceName: pv.piece.name, sizeKind: pv.piece.sizeKind, size: item.size,
          product: { id: option.product.id, url: option.product.url, currency: option.product.currency, title: option.product.title, image: option.product.image, priceCents: option.product.priceCents },
          merchant: { id: option.merchant.id, name: option.merchant.name },
        });
      }
    }

    const missing = lines.filter((l) => l.sizeKind !== "one_size" && !l.size).map((l) => l.pieceId);
    if (missing.length) {
      const names = lines.filter((l) => missing.includes(l.pieceId)).map((l) => l.pieceName);
      return reply({ status: "needs_sizes", pieceIds: missing, message: `Sizes are still needed for: ${names.join(", ")}.` });
    }

    // Merchant sizes can change after sourcing. Only the live offer decides
    // whether a size is valid, including full variant titles and size aliases.
    const checks = await Promise.all(lines.map((line) => verifyProduct(line.product, line.sizeKind === "one_size" ? null : line.size)));

    for (let i = 0; i < lines.length; i++) {
      const c = checks[i];
      const piece = { id: lines[i].pieceId, name: lines[i].pieceName };
      if (!c.verified) {
        if (c.invalidSize) return reply({ status: "invalid_size", pieceId: piece.id, pieceName: piece.name, availableSizes: c.availableSizes ?? [], message: `The merchant no longer offers that size for ${piece.name.toLowerCase()}. Ask the assistant for another size or pick.` });
        return reply({ status: "unverified", pieceId: piece.id, pieceName: piece.name, message: `We could not confirm the live price and stock for ${lines[i].product.title}. Try again or swap this piece.` }, 503);
      }
      if (c.verified && c.availability === "out_of_stock") {
        return reply({
          status: "sold_out",
          pieceId: piece.id,
          pieceName: piece.name,
          message: `${lines[i].product.title} just sold out at ${lines[i].merchant.name}. Pick another ${piece.name.toLowerCase()} to continue.`,
        });
      }
      if (c.availability !== "in_stock") return reply({ status: "unverified", pieceId: piece.id, pieceName: piece.name, message: `The merchant has not confirmed stock for ${lines[i].product.title}. Pick another ${piece.name.toLowerCase()} to continue.` }, 503);
    }

    const verified = checks as Extract<Verification, { verified: true }>[];
    const origin = requestOrigin;
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(origin).hostname);
    const priceChanges: PriceChange[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const expected = body.acceptedPrices?.find((value) => value.pieceId === line.pieceId && value.productId === line.product.id)?.priceCents ?? line.product.priceCents;
      // A web piece has no stored price, so the shopper must have seen one; otherwise show them the live price first.
      if (expected === null) { priceChanges.push({ pieceId: line.pieceId, pieceName: line.pieceName, productId: line.product.id, oldCents: verified[i].priceCents, newCents: verified[i].priceCents }); continue; }
      if (verified[i].priceCents !== expected) priceChanges.push({ pieceId: line.pieceId, pieceName: line.pieceName, productId: line.product.id, oldCents: expected, newCents: verified[i].priceCents });
    }
    if (priceChanges.length) return reply({ status: "price_changed", priceChanges, message: "The merchant prices changed. Review and accept the new prices before continuing." });

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    const metadata: Record<string, string> = { costume: costumeSlug };

    lines.forEach((l, i) => {
      const c = verified[i];
      const p = l.product;
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
            name: clip(`${l.pieceName}: ${p.title}`, 250),
            description: clip(`From ${l.merchant.name}${l.size ? ` · Size ${l.size}` : ""}`),
            ...(image ? { images: [image] } : {}),
            metadata: {
              merchant: clip(l.merchant.name),
              merchant_id: l.merchant.id,
              product_id: p.id,
              product_url: clip(c.productUrl),
              piece_id: l.pieceId,
              size: l.size ?? "one size",
              ...(c.variantId ? { variant_id: c.variantId } : {}),
              verified_at: c.checkedAt,
            },
          },
        },
      });

      metadata[`item_${i + 1}`] = clip(
        JSON.stringify({ piece: l.pieceId, merchant: l.merchant.name, url: c.productUrl, size: l.size ?? "one size", cents }),
      );
    });

    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      branding_settings: { display_name: "Halloween Supply", button_color: "#111111", background_color: "#ffffff" },
      line_items: lineItems,
      adaptive_pricing: { enabled: false },
      automatic_tax: { enabled: false },
      customer_creation: "if_required",
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      shipping_address_collection: { allowed_countries: ["US"] },
      metadata,
      payment_intent_data: { metadata },
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${cancelPath}`,
    });
    if (!session.url) throw new Error("Stripe returned a session without a URL.");

    return reply({ status: "ok", url: session.url, sessionId: session.id, priceChanges });
  } catch (e) {
    console.error("[checkout] session creation failed", e instanceof Error ? e.name : "UnknownError");
    return fail("Checkout could not start. Please try again.", 500);
  }
}
