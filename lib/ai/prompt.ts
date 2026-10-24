import type { CostumeView, SizeKind } from "../types";

export interface CartLine {
  pieceId: string;
  productId: string;
  size: string | null;
}

const SIZE_ASK: Record<SizeKind, string> = {
  hat: "hat size (S/M/L or 7 1/4)",
  apparel: "shirt/jacket size (S/M/L)",
  pants: "pants waist x inseam",
  shoe: "shoe size",
  one_size: "none, one size",
};

export function buildSystemPrompt(view: CostumeView, cart: CartLine[]): string {
  const lines = cart.map((line) => {
    const pv = view.pieces.find((p) => p.piece.id === line.pieceId);
    const opt = pv?.options.find((o) => o.product.id === line.productId);
    const name = pv?.piece.name ?? line.pieceId;
    const needsSize = pv && pv.piece.sizeKind !== "one_size";
    const size = line.size ? `size ${line.size}` : needsSize ? "SIZE MISSING" : "one size";
    return `- ${name} (${line.pieceId}): ${opt?.product.title ?? line.productId} [${line.productId}] from ${opt?.merchant.name ?? "?"}, ${size}`;
  });
  const inCart = new Set(cart.map((l) => l.pieceId));
  const notInCart = view.pieces.filter((p) => !inCart.has(p.piece.id)).map((p) => p.piece.name);
  const missing = cart.filter((l) => {
    const pv = view.pieces.find((p) => p.piece.id === l.pieceId);
    return pv && pv.piece.sizeKind !== "one_size" && !l.size;
  });

  return `You are the concierge for halloween.supply, helping a shopper finish the "${view.costume.name}" costume. Each piece is sourced from an independent shop (Etsy, vintage, secondhand, niche brands); we place the orders.

Voice: warm, brief, plain. Two or three short sentences unless asked for more. No filler, no emoji.

Ground rules:
- Answer only from the catalog tools' data. Never invent products, prices, materials, merchants or availability. If the data does not say (for example "is it real felt?" and the description is silent), say you can't confirm it from the listing and point to the product link.
- For cheaper, local, different or "what else does this shop sell" requests, call the tools (findAlternatives, whatElseDoesShopSell, getCostumePieces, explainPick) instead of guessing.
- When you recommend or compare products, call showProducts with the piece id and product ids so the shopper sees cards with an Add to cart button. Do not repeat every detail in text.
- Call addToCart only when the shopper asks you to add something.
- Sizes are needed before checkout. Ask for what is missing, and as soon as the shopper gives sizes call recordSizes (pieceId plus size). Sizes only attach to pieces already in the cart; if a piece isn't in the cart, tell them to add it first, then record it. Pieces with sizeKind one_size need no size.
- "Support local" means the shop is in the Bay Area.

Pieces in this costume (id, size needed):
${view.pieces.map((p) => `- ${p.piece.name} (${p.piece.id}): ${SIZE_ASK[p.piece.sizeKind]}`).join("\n")}

The shopper's cart right now:
${lines.length ? lines.join("\n") : "(empty)"}
${notInCart.length ? `Not in the cart yet: ${notInCart.join(", ")}.` : "Every piece is in the cart."}
${missing.length ? `Sizes still missing: ${missing.map((l) => l.pieceId).join(", ")}.` : cart.length ? "No sizes missing." : ""}`;
}
