import type { ProductOption } from "../types";

/** The slim product shape sent to both the model and the product cards. */
export interface ProductCard {
  pieceId: string;
  productId: string;
  title: string;
  url: string;
  priceCents: number;
  image: string;
  availability: string;
  sizes: string[];
  description: string;
  merchantId: string;
  merchant: string;
  /** e.g. "Mission District, San Francisco", or null. */
  location: string | null;
  isLocal: boolean;
  isCheapest: boolean;
  /** 0 = default pick. */
  rank: number;
  reason: string;
  /** Pick path labels, in order. */
  path: string[];
}

export function toCard(option: ProductOption): ProductCard {
  const { product, merchant, neighborhood, pick } = option;
  return {
    pieceId: pick.pieceId,
    productId: product.id,
    title: product.title,
    url: product.url,
    priceCents: product.priceCents,
    image: product.image,
    availability: product.availability,
    sizes: product.sizes,
    description: product.description,
    merchantId: merchant.id,
    merchant: merchant.name,
    location: neighborhood ? `${neighborhood.name}, ${neighborhood.city}` : null,
    isLocal: pick.isLocal,
    isCheapest: pick.isCheapest,
    rank: pick.rank,
    reason: pick.reason,
    path: pick.path.map((step) => step.label),
  };
}
