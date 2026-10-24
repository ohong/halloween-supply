import { z } from "zod";
import { getCostume, getProductOption } from "@/lib/catalog";
import { recheckAll, type RecheckInput } from "@/lib/checkout/recheck";
import { buildSessionParams, type SessionLine } from "@/lib/checkout/session-params";
import { createCheckoutSession, isStripeConfigured } from "@/lib/checkout/stripe";
import type { CheckoutRequest, CheckoutResponse, PriceChange } from "@/lib/checkout/types";
import type { Piece, ProductOption } from "@/lib/types";

export const maxDuration = 60;

const requestSchema = z.object({
  costumeSlug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  items: z
    .array(
      z.object({
        pieceId: z.string().min(1).max(100),
        productId: z.string().min(1).max(200),
        size: z.string().max(60).nullable(),
      }),
    )
    .min(1)
    .max(20),
}) satisfies z.ZodType<CheckoutRequest>;

function respond(body: CheckoutResponse, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return respond({ status: "error", message: "The checkout request was not valid JSON." }, 400);
  }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return respond({ status: "error", message: "The checkout request was malformed: expected costumeSlug and a non-empty list of items." }, 400);
  }
  const { costumeSlug, items } = parsed.data;

  const pieceIds = items.map((i) => i.pieceId);
  if (new Set(pieceIds).size !== pieceIds.length) {
    return respond({ status: "error", message: "The cart has the same piece twice. Keep one product per piece." }, 400);
  }

  // Resolve every product server-side; client prices are never used.
  let options: (ProductOption | null)[];
  let pieces: Map<string, Piece>;
  try {
    const [costume, found] = await Promise.all([
      getCostume(costumeSlug),
      Promise.all(items.map((i) => getProductOption(i.productId, i.pieceId))),
    ]);
    options = found;
    pieces = new Map((costume?.pieces ?? []).map((p) => [p.piece.id, p.piece]));
  } catch (e) {
    console.error("[checkout] catalog lookup failed", e);
    return respond({ status: "error", message: "We couldn't look up your cart right now. Please try again in a moment." }, 503);
  }
  const missing = items.filter((item, i) => options[i] === null || !pieces.has(item.pieceId));
  if (missing.length > 0) {
    return respond(
      { status: "error", message: `Some items in your cart are no longer available (${missing.map((m) => m.pieceId).join(", ")}). Refresh the page and pick them again.` },
      400,
    );
  }
  const resolved = items.map((item, i) => ({ item, option: options[i] as ProductOption }));

  const needSizes = resolved.filter(
    ({ item }) => (pieces.get(item.pieceId) as Piece).sizeKind !== "one_size" && !item.size?.trim(),
  );
  if (needSizes.length > 0) {
    return respond(
      {
        status: "needs_sizes",
        pieceIds: needSizes.map((n) => n.item.pieceId),
        message: `Sizes are needed before checkout for: ${needSizes.map((n) => n.item.pieceId).join(", ")}.`,
      },
      422,
    );
  }

  if (!isStripeConfigured()) {
    return respond({ status: "error", message: "Checkout is not available yet: payments are not configured on this server (STRIPE_SECRET_KEY is missing)." }, 503);
  }

  // Re-check price and stock at the merchant, in parallel.
  const inputs: RecheckInput[] = resolved.map(({ item, option }) => ({
    pieceId: item.pieceId,
    pieceName: (pieces.get(item.pieceId) as Piece).name,
    url: option.product.url,
    storedCents: option.product.priceCents,
  }));
  const checks = await recheckAll(inputs);
  for (const c of checks) if (c.note) console.warn(`[checkout] recheck ${c.pieceId}: ${c.note}`);

  const soldOut = checks.find((c) => c.availability === "out_of_stock");
  if (soldOut) {
    const merchant = resolved.find((r) => r.item.pieceId === soldOut.pieceId)?.option.merchant.name ?? "the merchant";
    return respond(
      {
        status: "sold_out",
        pieceId: soldOut.pieceId,
        pieceName: soldOut.pieceName,
        message: `${soldOut.pieceName} from ${merchant} just sold out — swap it for one of the alternatives.`,
      },
      409,
    );
  }

  const origin = new URL(request.url).origin;
  const lines: SessionLine[] = resolved.map(({ item, option }, i) => ({
    pieceId: item.pieceId,
    pieceName: inputs[i].pieceName,
    productId: option.product.id,
    title: option.product.title,
    merchantId: option.merchant.id,
    merchantName: option.merchant.name,
    productUrl: option.product.url,
    image: option.product.image,
    size: item.size?.trim() || null,
    priceCents: checks[i].priceCents,
    priceUnverified: checks[i].priceUnverified,
  }));
  const priceChanges: PriceChange[] = checks.flatMap((c) => (c.priceChange ? [c.priceChange] : []));

  try {
    const session = await createCheckoutSession(buildSessionParams({ origin, costumeSlug, lines }));
    if (!session.url) throw new Error("Stripe returned a session without a URL");
    return respond({ status: "ok", url: session.url, sessionId: session.id, priceChanges });
  } catch (e) {
    console.error("[checkout] stripe session failed", e);
    return respond({ status: "error", message: "We couldn't start the payment page. Please try again in a moment." }, 502);
  }
}
