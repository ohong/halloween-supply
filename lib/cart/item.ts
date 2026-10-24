import type { CartItem, Piece, ProductOption } from "../types";

/** The cart line for choosing `option` for `piece`. Size starts empty; the assistant fills it. */
export function toCartItem(piece: Piece, option: ProductOption, size: string | null = null): CartItem {
  return {
    pieceId: piece.id,
    pieceName: piece.name,
    sizeKind: piece.sizeKind,
    productId: option.product.id,
    title: option.product.title,
    productUrl: option.product.url,
    image: option.product.image,
    merchantId: option.merchant.id,
    merchantName: option.merchant.name,
    priceCents: option.product.priceCents,
    size,
  };
}
