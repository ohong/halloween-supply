import { cached } from "../sourcing/cache";
import { parsePriceToCents } from "./price";

interface ShopifyVariant {
  id: number;
  title: string;
  available: boolean;
  price: number;
  options?: string[];
  featured_image?: { src?: string } | null;
}
interface ShopifyProduct {
  title: string;
  description?: string;
  images: string[];
  variants: ShopifyVariant[];
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
      if (!Array.isArray(data.variants) || !data.variants.every((v: ShopifyVariant) => Number.isInteger(v.price) && typeof v.available === "boolean")) return null;
      return data as ShopifyProduct;
    } catch { return null; }
  };
  return useCache ? cached("shopify", { url: u.toString() }, load) : load();
}

export function selectShopifyVariants(product: ShopifyProduct, color?: string) {
  const available = product.variants.filter((v) => v.available && (!color || v.title.split(" / ").some((p) => p.toLowerCase() === color.toLowerCase())));
  const lowest = Math.min(...available.map((v) => v.price));
  return available.filter((v) => v.price === lowest && parsePriceToCents(v.price / 100) === v.price);
}
