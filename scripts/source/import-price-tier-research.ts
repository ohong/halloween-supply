// Import reviewed built-in-web research; this does not search or publish to the database.
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { costumes } from "../../lib/costumes";
import { validateSnapshot } from "../../lib/catalog/validate";
import { readShopifyProduct, shopifySizes } from "../../lib/products/shopify";
import type { CostumeSnapshot, Merchant, Product } from "../../lib/types";

const optionSchema = z.object({
  tier: z.enum(["$", "$$", "$$$"]), existingProductId: z.string().optional(),
  title: z.string().min(1), url: z.url(), priceCents: z.number().int().positive(),
  currency: z.literal("USD"), merchantName: z.string().min(1), merchantDomain: z.string().min(1),
  imageUrl: z.url(), sizes: z.array(z.string()), availability: z.enum(["in_stock", "unknown"]),
  evidenceUrl: z.url(), notes: z.string().min(1),
});
const researchSchema = z.object({
  costumeSlug: z.string().regex(/^[a-z0-9-]+$/), checkedAt: z.iso.datetime({ offset: true }),
  pieces: z.array(z.object({
    pieceId: z.string().regex(/^[a-z0-9-]+$/), pieceName: z.string().min(1),
    category: z.string().min(1).optional(), required: z.boolean().optional(), order: z.number().int().nonnegative().optional(),
    styleNotes: z.string().optional(), queries: z.array(z.string().min(1)).min(1).optional(),
    sizeKind: z.enum(["apparel", "pants", "shoe", "hat", "one_size"]).optional(),
    options: z.array(optionSchema).length(3), gaps: z.array(z.string()),
  })).min(1).max(7),
});
const directory = process.argv[2];
if (!directory) throw new Error("Pass the directory containing reviewed research JSON files.");
const slugify = (value: string) => value.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const catalogFiles = new Set(costumes.map((costume) => costume.slug + ".json"));
const files = (await readdir(directory)).filter((name) => catalogFiles.has(name)).sort();
let failures = 0;
for (const filename of files) {
  try {
  const research = researchSchema.parse(JSON.parse(await readFile(path.join(directory, filename), "utf8")));
  const target = path.join("data/costumes", research.costumeSlug + ".json");
  const editorial = costumes.find((costume) => costume.slug === research.costumeSlug);
  if (!editorial || filename !== research.costumeSlug + ".json") throw new Error("Unknown or mismatched costume slug.");
  let previous: CostumeSnapshot;
  try { previous = validateSnapshot(JSON.parse(await readFile(target, "utf8")), false); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    previous = {
      costume: { slug: editorial.slug, name: editorial.name, description: editorial.description, image: editorial.image, alt: editorial.alt, status: "live" },
      pieces: research.pieces.map((piece) => {
        if (!piece.category || piece.required === undefined || piece.order === undefined || !piece.sizeKind || !piece.queries) throw new Error("New pieces need complete metadata: " + piece.pieceId);
        return { id: piece.pieceId, name: piece.pieceName, category: piece.category, required: piece.required, order: piece.order,
          styleNotes: [piece.styleNotes, ...piece.gaps].filter(Boolean).join(" "), queries: piece.queries, sizeKind: piece.sizeKind, matches: [] };
      }),
      products: [], merchants: [], neighborhoods: [], tags: [],
      provenance: { method: "manual-research", generatedAt: research.checkedAt },
    };
  }
  const completeMetadata = research.pieces.every((piece) => piece.category && piece.required !== undefined && piece.order !== undefined && piece.sizeKind && piece.queries);
  if (!completeMetadata && (research.pieces.length !== previous.pieces.length || research.pieces.some((piece) => !previous.pieces.some((old) => old.id === piece.pieceId)))) throw new Error("Changing component coverage requires complete component metadata.");
  const sourcePieces = research.pieces.map((row) => {
    const old = previous.pieces.find((piece) => piece.id === row.pieceId);
    if (!row.category || row.required === undefined || row.order === undefined || !row.sizeKind || !row.queries) {
      if (!old) throw new Error("Missing component metadata for " + row.pieceId);
      return old;
    }
    return { id: row.pieceId, name: row.pieceName, category: row.category, required: row.required, order: row.order,
      sizeKind: row.sizeKind, queries: row.queries, styleNotes: [row.styleNotes, ...row.gaps].filter(Boolean).join(" "), matches: old?.matches ?? [] };
  });
  const existing = new Map(previous.products.map((product) => [product.id, product]));
  const merchants = new Map(previous.merchants.map((merchant) => [merchant.id, merchant]));
  const products = new Map<string, Product>();
  const pieces = [];
  for (const piece of sourcePieces) {
    const row = research.pieces.find((candidate) => candidate.pieceId === piece.id);
    if (!row) throw new Error("Missing research for " + piece.id);
    if (row.options.map((option) => option.tier).join(",") !== "$,$$,$$$") throw new Error("Research tiers must be ascending for " + piece.id);
    if (!(row.options[0].priceCents < row.options[1].priceCents && row.options[1].priceCents < row.options[2].priceCents)) throw new Error("Prices must differ for " + piece.id);
    const options = await Promise.all(row.options.map(async (option) => {
      const old = option.existingProductId ? existing.get(option.existingProductId) : previous.products.find((product) => product.url === option.url);
      if (option.existingProductId && !old) throw new Error("Unknown existing product: " + option.existingProductId);
      const domain = option.merchantDomain.replace(/^www\./, "").toLowerCase();
      const marketplace = domain === "etsy.com";
      let merchant = [...merchants.values()].find((candidate) => candidate.domain.replace(/^www\./, "") === domain
        && (!marketplace || candidate.name.toLowerCase() === option.merchantName.toLowerCase()));
      if (!merchant) {
        merchant = { id: marketplace ? "etsy-" + slugify(option.merchantName) : slugify(domain), name: option.merchantName, domain, url: marketplace ? option.url : "https://" + domain + "/", kind: marketplace ? "etsy" : "boutique", neighborhoodId: null } satisfies Merchant;
        merchants.set(merchant.id, merchant);
      }
      const id = old?.id ?? "p-" + createHash("sha256").update(option.url).digest("hex").slice(0, 10);
      let sizes = option.sizes;
      const variantId = new URL(option.url).searchParams.get("variant");
      if (variantId) {
        const shopify = await readShopifyProduct(option.url, false);
        const anchor = shopify?.variants.find((variant) => String(variant.id) === variantId);
        if (shopify && anchor) {
          if (!anchor.available || anchor.price !== option.priceCents) throw new Error("Merchant variant changed since research: " + option.url);
          const names = shopify.options.map((name) => typeof name === "string" ? name : name.name);
          if (names.some((name) => /\bsize\b/i.test(name))) {
            // A tier price is valid only for size variants sold at that exact price.
            sizes = shopifySizes({ ...shopify, variants: shopify.variants.filter((variant) => variant.price === anchor.price) }, anchor);
          }
        }
      }
      const product: Product = {
        ...old, id, title: option.title, url: option.url, priceCents: option.priceCents, currency: "USD",
        image: old?.image ?? option.imageUrl, sourceImages: [option.imageUrl],
        availability: option.availability, sizes, merchantId: merchant.id,
        tagSlugs: old?.tagSlugs ?? [], description: option.notes, checkedAt: research.checkedAt,
        sourcing: { method: "built-in-web", checkedAt: research.checkedAt, url: option.evidenceUrl, notes: option.notes },
      };
      products.set(id, product);
      return { product, tier: option.tier, notes: option.notes };
    }));
    // Retain a researched styling pick when possible; otherwise start in the middle price band.
    const oldDefault = piece.matches.find((match) => match.rank === 0)?.productId;
    const defaultIndex = Math.max(0, options.findIndex(({ product }) => product.id === oldDefault));
    const preferred = options.some(({ product }) => product.id === oldDefault && product.availability === "in_stock") ? defaultIndex
      : options[1].product.availability === "in_stock" ? 1 : options.findIndex(({ product }) => product.availability === "in_stock");
    if (preferred < 0) throw new Error("No stock-confirmed option for " + piece.id);
    const order = [options[preferred], ...options.filter((_, index) => index !== preferred)];
    pieces.push({ ...piece, matches: order.map(({ product, notes }, rank) => ({ productId: product.id, rank, reason: notes })) });
  }
  const matchedIds = pieces.flatMap((piece) => piece.matches.map((match) => match.productId));
  if (new Set(matchedIds).size !== matchedIds.length) throw new Error("A product is charged under multiple pieces. Group confirmed bundles into one purchasable component.");
  const usedMerchantIds = new Set([...products.values()].map((product) => product.merchantId));
  const snapshot: CostumeSnapshot = {
    ...previous, pieces, products: [...products.values()], merchants: [...merchants.values()].filter((merchant) => usedMerchantIds.has(merchant.id)),
    provenance: { method: "manual-research", generatedAt: research.checkedAt, priceTiers: true,
      ...(previous.costume.image.startsWith("/costumes/") ? { heroImageKind: "generated-reference" as const } : {}),
      notes: "Built-in web search and direct official merchant evidence. Three distinct relative price points per piece: $, $$, $$$. Prices exclude shipping/tax; stock is variant-specific and delivery is unconfirmed. See docs/sourcing/price-tiers/" + filename + "." },
  };
  validateSnapshot(snapshot);
  await writeFile(target, JSON.stringify(snapshot, null, 2) + "\n");
  await copyFile(path.join(directory, filename), path.join("docs/sourcing/price-tiers", filename));
  console.log(research.costumeSlug + ": imported " + products.size + " products across three price points per piece.");
  } catch (error) {
    failures++;
    console.error(filename + ": " + (error instanceof Error ? error.message : "Research import failed."));
  }
}
if (failures) process.exitCode = 1;
