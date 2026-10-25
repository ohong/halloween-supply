import type { CartItem, Piece, ProductOption } from "../types";

const normalizedSize = (size: string) => size.trim().replace(/\s+/g, " ").toLowerCase();

/** Only whitespace/case can differ. Merchant labels never imply a size conversion. */
export function compatibleSize(item: Pick<CartItem, "sizeKind" | "availableSizes">, size: string | null | undefined): string | null {
  if (item.sizeKind === "one_size" || !size?.trim()) return null;
  return item.availableSizes.find((offered) => normalizedSize(offered) === normalizedSize(size)) ?? null;
}

/** The cart line for choosing `option` for `piece`. Size starts empty; the assistant fills it. */
export function toCartItem(piece: Piece, option: ProductOption, size: string | null = null): CartItem {
  const item: CartItem = {
    pieceId: piece.id,
    pieceName: piece.name,
    sizeKind: piece.sizeKind,
    productId: option.product.id,
    title: option.product.title,
    productUrl: option.product.url,
    image: option.product.cutout ?? option.product.image,
    merchantId: option.merchant.id,
    merchantName: option.merchant.name,
    priceCents: option.product.priceCents,
    availableSizes: [...option.product.sizes],
    size: null,
  };
  return { ...item, size: compatibleSize(item, size) };
}
