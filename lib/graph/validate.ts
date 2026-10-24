import { z } from "zod";
import { hostnameOf, isBlockedDomain, isNoiseDomain } from "../sourcing/blocklist";
import type { CostumeSnapshot } from "../types";

const text = z.string().trim().min(1);
const id = text;
const url = z.url().refine((value) => /^https?:/.test(value), "must use HTTP or HTTPS");
const image = z.string().refine((value) => value.startsWith("/") || /^https?:\/\//.test(value), "must be a public path or image URL");
const unique = (values: string[]) => new Set(values).size === values.length;

const schema = z.object({
  costume: z.object({
    slug: id,
    name: text,
    description: text,
    image,
    alt: text,
    status: z.enum(["live", "coming_soon"]),
  }),
  pieces: z.array(z.object({
    id,
    name: text,
    category: text,
    required: z.boolean(),
    order: z.number().int().nonnegative(),
    styleNotes: z.string(),
    queries: z.array(text),
    sizeKind: z.enum(["apparel", "pants", "shoe", "hat", "one_size"]),
    matches: z.array(z.object({ productId: id, rank: z.number().int().nonnegative(), reason: text })),
  })).min(1),
  products: z.array(z.object({
    id,
    title: text,
    url,
    priceCents: z.number().int().positive().max(99_999_999),
    currency: z.literal("USD"),
    image,
    cutout: z.string().regex(/^\/products\/[a-z0-9-]+-cutout\.png$/).optional(),
    sourceImages: z.array(url).min(1),
    availability: z.enum(["in_stock", "out_of_stock", "unknown"]),
    sizes: z.array(text),
    merchantId: id,
    tagSlugs: z.array(id),
    description: z.string(),
    checkedAt: z.iso.datetime({ offset: true }),
  })),
  merchants: z.array(z.object({
    id,
    name: text,
    domain: text,
    url,
    kind: z.enum(["etsy", "vintage", "secondhand", "pawn", "dtc", "boutique"]),
    neighborhoodId: id.nullable(),
  })),
  neighborhoods: z.array(z.object({ id, name: text, city: text, region: text.nullable() })),
  tags: z.array(z.object({ slug: id, label: text })),
  provenance: z.object({
    method: z.enum(["pipeline", "manual-research"]),
    generatedAt: z.iso.datetime({ offset: true }),
    notes: z.string().optional(),
  }),
});

/** Reject broken links and unpublishable live catalogs before the first graph write. */
export function validateSnapshot(value: unknown): CostumeSnapshot {
  const snapshot = schema.parse(value);
  const { costume, pieces, products, merchants, neighborhoods, tags } = snapshot;
  const errors: string[] = [];
  const assert = (condition: boolean, message: string) => { if (!condition) errors.push(message); };
  for (const [label, values] of [
    ["piece", pieces.map((piece) => piece.id)],
    ["product", products.map((product) => product.id)],
    ["merchant", merchants.map((merchant) => merchant.id)],
    ["neighborhood", neighborhoods.map((neighborhood) => neighborhood.id)],
    ["tag", tags.map((tag) => tag.slug)],
  ] as const) assert(unique([...values]), `Duplicate ${label} IDs`);
  assert(unique(pieces.map((piece) => String(piece.order))), "Piece display orders must be unique");
  const productById = new Map(products.map((product) => [product.id, product]));
  const merchantById = new Map(merchants.map((merchant) => [merchant.id, merchant]));
  const neighborhoodIds = new Set(neighborhoods.map((neighborhood) => neighborhood.id));
  const tagIds = new Set(tags.map((tag) => tag.slug));
  for (const merchant of merchants) {
    assert(!isBlockedDomain(merchant.domain) && !isBlockedDomain(merchant.url) && !isNoiseDomain(merchant.url), `Merchant ${merchant.id} is blocked`);
    assert(merchant.neighborhoodId === null || neighborhoodIds.has(merchant.neighborhoodId), `Merchant ${merchant.id} has an unknown neighborhood`);
    const host = hostnameOf(merchant.url);
    assert(host === merchant.domain || !!host?.endsWith(`.${merchant.domain}`), `Merchant ${merchant.id} domain does not match its URL`);
  }
  for (const product of products) {
    const merchant = merchantById.get(product.merchantId);
    assert(!!merchant, `Product ${product.id} has an unknown merchant`);
    assert(!isBlockedDomain(product.url) && !isNoiseDomain(product.url), `Product ${product.id} is blocked`);
    const host = hostnameOf(product.url);
    if (merchant) assert(host === merchant.domain || !!host?.endsWith(`.${merchant.domain}`), `Product ${product.id} URL does not belong to its merchant`);
    assert(unique(product.tagSlugs), `Product ${product.id} has duplicate tags`);
    assert(product.tagSlugs.every((tag) => tagIds.has(tag)), `Product ${product.id} has an unknown tag`);
  }
  for (const piece of pieces) {
    assert(unique(piece.matches.map((match) => match.productId)), `Piece ${piece.id} has duplicate products`);
    assert(unique(piece.matches.map((match) => String(match.rank))), `Piece ${piece.id} has duplicate ranks`);
    assert(piece.matches.every((match) => productById.has(match.productId)), `Piece ${piece.id} has an unknown product`);
    if (costume.status === "live") {
      assert(piece.matches.length === 3 && piece.matches.every((match) => match.rank <= 2), `Live piece ${piece.id} needs ranks 0, 1, and 2`);
      const defaultPick = piece.matches.find((match) => match.rank === 0);
      assert(!!defaultPick && productById.get(defaultPick.productId)?.availability === "in_stock", `Live piece ${piece.id} needs an in-stock default`);
    }
  }
  if (errors.length) throw new Error(`Invalid catalog snapshot: ${errors.join("; ")}`);
  return snapshot;
}
