import "server-only";

import { fetchProductPage } from "../brightdata/client";
import { parseProduct, readJsonLdBlocks } from "../products/parse";
import { parsePriceToCents } from "../products/price";
import { isBlockedDomain, isNoiseDomain, registrableDomain } from "../sourcing/blocklist";
import type { Availability, Product } from "../types";

export const VERIFY_TIMEOUT_MS = 10_000;

export type Verification =
  | {
      verified: true;
      priceCents: number;
      availability: Availability;
      sizes: string[];
      checkedAt: string;
      /** The exact variant URL, when the merchant exposes one. */
      productUrl: string;
      variantId?: string;
    }
  | { verified: false; reason: string; availableSizes?: string[]; invalidSize?: boolean };

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);
const array = (value: unknown): unknown[] => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const normalizedSize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const validPrice = (value: number | null): value is number => value !== null && Number.isSafeInteger(value) && value > 0 && value <= 99_999_999;
const sameMerchant = (a: string, b: string) => registrableDomain(a) === registrableDomain(b);

async function merchantFetch(url: string): Promise<Response> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    headers: { "Accept-Language": "en-US,en;q=0.9", Accept: "text/html,application/json" },
  });
  if (!response.ok || !sameMerchant(response.url, url)) throw new Error("Merchant page could not be verified.");
  return response;
}

async function livePage(url: string): Promise<string> {
  try {
    return await (await merchantFetch(url)).text();
  } catch {
    const page = await fetchProductPage(url, { timeoutMs: VERIFY_TIMEOUT_MS, retries: 0 });
    if (!sameMerchant(page.finalUrl, url)) throw new Error("Merchant redirected to another shop.");
    return page.html;
  }
}

/** Shopify's public product endpoint carries per-variant cents and stock, unlike its aggregate JSON-LD offers. */
async function shopifyProduct(url: URL): Promise<{ product: RecordValue; currency: string | null } | null> {
  if (!/\/products\/[^/]+\/?$/.test(url.pathname)) return null;
  const endpoint = new URL(url);
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}.js`;
  endpoint.search = "";
  const cart = new URL(url);
  cart.pathname = `${url.pathname.split("/products/")[0]}/cart.js`;
  cart.search = "";
  // Preserve an explicit USD presentment selection on both independent checks.
  // Otherwise an overseas shop can return its native currency for the Ajax API.
  if (url.searchParams.get("currency") === "USD") {
    endpoint.searchParams.set("currency", "USD");
    cart.searchParams.set("currency", "USD");
  }
  try {
    const [value, currency] = await Promise.all([
      merchantFetch(endpoint.toString()).then((response) => response.json() as Promise<unknown>),
      merchantFetch(cart.toString()).then((response) => response.json() as Promise<unknown>).then((value) => record(value) ? text(value.currency)?.toUpperCase() ?? null : null).catch(() => null),
    ]);
    return record(value) && Array.isArray(value.variants) ? { product: value, currency } : null;
  } catch {
    return null;
  }
}

function readShopify(
  value: RecordValue,
  url: URL,
  selectedSize: string | null | undefined,
  currency: string | null,
): Verification {
  if (currency !== "USD") return { verified: false, reason: "The merchant currency is not confirmed as USD." };
  const variants = array(value.variants).filter(record);
  if (!variants.length || value.requires_selling_plan === true) return { verified: false, reason: "No one-time merchant variant could be verified." };
  if (typeof value.handle !== "string" || decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "") !== value.handle) {
    return { verified: false, reason: "The merchant returned a different product." };
  }
  const optionNames = array(value.options).map((option) => record(option) ? text(option.name) ?? "" : text(option) ?? "");
  const sizeIndex = optionNames.findIndex((name) => /\bsize\b/i.test(name));
  const option = (variant: RecordValue, index: number) => text(variant[`option${index + 1}`]) ?? (Array.isArray(variant.options) ? text(variant.options[index]) : null);
  // Keep the product's selected color/material while changing its size.
  const anchor = variants.find((variant) => String(variant.id) === url.searchParams.get("variant")) ?? variants[0];
  const family = variants.filter((variant) => optionNames.every((_, index) => index === sizeIndex || option(variant, index) === option(anchor, index)));
  const size = (variant: RecordValue) => sizeIndex < 0 ? "one size" : option(variant, sizeIndex);
  const sizes = [...new Set(family.filter((variant) => variant.available === true).map(size).filter((s): s is string => s !== null))];
  const matching = selectedSize === undefined
    ? family
    : selectedSize === null
      ? [anchor]
      : family.filter((variant) =>
          (size(variant) !== null && normalizedSize(size(variant)!) === normalizedSize(selectedSize)) ||
          (text(variant.title) !== null && normalizedSize(text(variant.title)!) === normalizedSize(selectedSize)),
        );
  if (!matching.length) return { verified: false, invalidSize: true, availableSizes: sizes, reason: "The selected size is not offered by the merchant." };
  const available = matching.filter((variant) => variant.available === true);
  const chosen = (available.length ? available : matching).slice().sort((a, b) => Number(a.price) - Number(b.price))[0];
  const cents = typeof chosen.price === "number" ? chosen.price : null;
  if (!validPrice(cents) || typeof chosen.available !== "boolean") return { verified: false, reason: "The selected variant price or stock is missing." };
  const variantId = String(chosen.id);
  if (!/^\d+$/.test(variantId)) return { verified: false, reason: "The merchant variant is missing." };
  const productUrl = new URL(url);
  productUrl.searchParams.set("variant", variantId);
  return { verified: true, priceCents: cents, availability: chosen.available ? "in_stock" : "out_of_stock", sizes, checkedAt: new Date().toISOString(), productUrl: productUrl.toString(), variantId };
}

interface Offer {
  priceCents: number;
  currency: string | null;
  availability: Availability;
  size: string | null;
  url: string;
}

/** Restrict charges to exact offers. AggregateOffer.lowPrice cannot price a chosen size. */
function exactOffers(html: string, url: string): Offer[] {
  const offers: Offer[] = [];
  const products: RecordValue[] = [];
  const productTypes = new Set(["Product", "ProductGroup", "IndividualProduct"]);
  const collect = (value: unknown, depth: number) => {
    if (depth > 6) return;
    if (Array.isArray(value)) { for (const item of value) collect(item, depth + 1); return; }
    if (!record(value)) return;
    if (array(value["@type"]).some((type) => typeof type === "string" && productTypes.has(type.split(/[/#]/).at(-1) ?? ""))) products.push(value);
    for (const key of ["@graph", "mainEntity"]) if (key in value) collect(value[key], depth + 1);
  };
  for (const block of readJsonLdBlocks(html)) collect(block, 0);
  const original = new URL(url);
  const sameProduct = (value: RecordValue) => {
    const identifier = text(value.url) ?? text(value["@id"]);
    if (!identifier) return products.length === 1;
    try { const candidate = new URL(identifier, url); return sameMerchant(candidate.toString(), url) && candidate.pathname.replace(/\/$/, "") === original.pathname.replace(/\/$/, ""); } catch { return false; }
  };
  const stock = (value: unknown): Availability => {
    if (typeof value !== "string") return "unknown";
    const name = value.split(/[/#]/).at(-1)?.toLowerCase();
    return name === "instock" || name === "limitedavailability" ? "in_stock" : name === "outofstock" || name === "soldout" || name === "discontinued" ? "out_of_stock" : "unknown";
  };
  const size = (value: unknown): string | null => text(value) ?? (record(value) ? text(value.name) ?? text(value.value) : typeof value === "number" ? String(value) : null);
  const visit = (value: unknown, inheritedSize: string | null, depth: number) => {
    if (depth > 8) return;
    if (Array.isArray(value)) { for (const item of value) visit(item, inheritedSize, depth + 1); return; }
    if (!record(value)) return;
    const ownSize = size(value.size) ?? inheritedSize;
    const type = array(value["@type"]).filter((item): item is string => typeof item === "string");
    if (type.some((item) => /(?:^|[/#])Offer$/.test(item))) {
      const cents = parsePriceToCents(value.price);
      if (validPrice(cents)) {
        let offerUrl = url;
        try { const candidate = new URL(text(value.url) ?? url, url); if (sameMerchant(candidate.toString(), url)) offerUrl = candidate.toString(); } catch { /* Preserve the known product URL. */ }
        offers.push({ priceCents: cents, currency: text(value.priceCurrency)?.toUpperCase() ?? null, availability: stock(value.availability), size: ownSize, url: offerUrl });
      }
    }
    // Do not traverse recommendation lists, reviews or unrelated page content.
    for (const key of ["hasVariant", "offers"]) if (key in value) visit(value[key], ownSize, depth + 1);
  };
  for (const product of products.filter(sameProduct)) visit(product, null, 0);
  return offers;
}

/** No cache, stale-price fallback or model inference is allowed at the point of charging. */
export async function verifyProduct(
  product: Pick<Product, "id" | "url" | "currency">,
  selectedSize?: string | null,
): Promise<Verification> {
  try {
    const url = new URL(product.url);
    if (url.protocol !== "https:" || isBlockedDomain(product.url) || isNoiseDomain(product.url) || product.currency !== "USD") {
      return { verified: false, reason: "This merchant cannot be checked out." };
    }
    const [html, shopify] = await Promise.all([livePage(product.url), shopifyProduct(url)]);
    const parsed = parseProduct(html, product.url);
    if (shopify) {
      // The Ajax API returns presentment currency. The merchant's cart endpoint identifies that currency explicitly.
      if (shopify.currency !== null && parsed.currency !== null && shopify.currency !== parsed.currency) return { verified: false, reason: "The merchant page and variant currencies do not agree." };
      const declaredCurrency = html.match(/Shopify\.currency\s*=\s*\{\s*["']?active["']?\s*:\s*["']([A-Z]{3})["']/)?.[1] ?? null;
      return readShopify(shopify.product, url, selectedSize, shopify.currency ?? parsed.currency ?? declaredCurrency);
    }

    const offers = exactOffers(html, product.url);
    const sizes = [...new Set(offers.filter((offer) => offer.availability === "in_stock" && offer.size).map((offer) => offer.size!))];
    const matching = selectedSize === undefined ? offers : offers.filter((offer) =>
      selectedSize === null || normalizedSize(selectedSize) === "one size"
        ? offer.size === null || normalizedSize(offer.size) === "one size"
        : offer.size !== null && normalizedSize(offer.size) === normalizedSize(selectedSize),
    );
    if (!matching.length) return { verified: false, reason: "No exact merchant offer confirms this size and price.", ...(selectedSize !== undefined && sizes.length ? { invalidSize: true, availableSizes: sizes } : {}) };
    const inStock = matching.filter((offer) => offer.availability === "in_stock");
    const pool = inStock.length ? inStock : matching;
    // Different unsized offers are ambiguous, even when their lowest price looks attractive.
    if (new Set(pool.map((offer) => `${offer.priceCents}:${offer.currency}:${offer.availability}`)).size > 1) {
      return { verified: false, reason: "The merchant offers different prices or stock for this selection." };
    }
    const chosen = pool[0];
    if (chosen.currency !== "USD") return { verified: false, reason: "The merchant currency is not confirmed as USD." };
    return { verified: true, priceCents: chosen.priceCents, availability: chosen.availability, sizes, checkedAt: new Date().toISOString(), productUrl: chosen.url };
  } catch {
    console.warn(`[checkout] live merchant verification unavailable for ${product.id}`);
    return { verified: false, reason: "The merchant did not provide a verifiable live offer." };
  }
}
