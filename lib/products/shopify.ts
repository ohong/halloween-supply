import { cached } from "../sourcing/cache";
import { parsePriceToCents } from "./price";

interface ShopifyVariant {
  id: number;
  title: string;
  available: boolean;
  price: number;
  options?: string[];
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  featured_image?: { src?: string } | null;
}
interface ShopifyProduct {
  title: string;
  description?: string;
  images: string[];
  variants: ShopifyVariant[];
  options: Array<string | { name: string }>;
}

const optionNames = (product: ShopifyProduct) => product.options.map((option) => typeof option === "string" ? option : option.name);
const optionValue = (variant: ShopifyVariant, index: number): string | null => {
  const value = ([variant.option1, variant.option2, variant.option3][index] ?? variant.options?.[index]);
  return typeof value === "string" && value.trim() ? value : null;
};
const sameLabel = (a: string | null, b: string) => a?.trim().toLowerCase() === b.trim().toLowerCase();

/** Merchant picker prompts are not purchasable sizes, even when marked available. */
export const isRealSizeLabel = (value: string | null): value is string => value !== null
  && !/^(?:[\s\-–—]*)(?:please\s+)?(?:choose|select)\b.*\bsize\b/i.test(value);

function variantFamily(product: ShopifyProduct, anchor: ShopifyVariant): ShopifyVariant[] {
  const names = optionNames(product);
  const sizeIndex = names.findIndex((name) => /\bsize\b/i.test(name));
  return product.variants.filter((variant) => names.every((_, index) => index === sizeIndex || optionValue(variant, index) === optionValue(anchor, index)));
}

/** Match checkout's labels and preserve the selected color, width and other non-size options. */
export function shopifySizes(product: ShopifyProduct, anchor: ShopifyVariant): string[] {
  const sizeIndex = optionNames(product).findIndex((name) => /\bsize\b/i.test(name));
  // One saved price cannot also advertise sizes sold at a different price.
  return [...new Set(variantFamily(product, anchor).filter((variant) => variant.available && variant.price === anchor.price).map((variant) => sizeIndex < 0 ? "one size" : optionValue(variant, sizeIndex)).filter(isRealSizeLabel))];
}

/** Public merchant data. No admin credentials or inventory guesses. */
export async function readShopifyProduct(url: string, useCache = true): Promise<ShopifyProduct | null> {
  const u = new URL(url);
  if (!/\/products\/[^/]+\/?$/.test(u.pathname)) return null;
  u.pathname = u.pathname.replace(/\/$/, "") + ".js";
  u.search = "?currency=USD";
  const load = async (): Promise<ShopifyProduct | null> => {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data.variants) || !data.variants.every((v: ShopifyVariant) => Number.isInteger(v.price) && typeof v.available === "boolean") ||
        !Array.isArray(data.options) || !data.options.every((option: unknown) => typeof option === "string" || typeof option === "object" && option !== null && "name" in option && typeof option.name === "string")) return null;
      return data as ShopifyProduct;
    } catch { return null; }
  };
  return useCache ? cached("shopify", { url: u.toString() }, load) : load();
}

export function selectShopifyVariants(product: ShopifyProduct, color?: string, pinnedVariantId?: string | null) {
  const names = optionNames(product);
  const sizeIndex = names.findIndex((name) => /\bsize\b/i.test(name));
  const matchesColor = (variant: ShopifyVariant) => !color || names.some((_, index) => index !== sizeIndex && sameLabel(optionValue(variant, index), color));
  const hasRealSize = (variant: ShopifyVariant) => sizeIndex < 0 || isRealSizeLabel(optionValue(variant, sizeIndex));
  const candidates = product.variants.filter((variant) => variant.available && matchesColor(variant) && hasRealSize(variant)).sort((a, b) => a.price - b.price);
  const anchor = product.variants.find((variant) => String(variant.id) === pinnedVariantId) ?? candidates[0];
  if (!anchor || !matchesColor(anchor)) return [];
  const available = variantFamily(product, anchor).filter((variant) => variant.available && matchesColor(variant) && hasRealSize(variant));
  const lowest = Math.min(...available.map((v) => v.price));
  return available.filter((v) => v.price === lowest && parsePriceToCents(v.price / 100) === v.price);
}
