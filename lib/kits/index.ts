import { KITS } from "../../data/kits";
import type { CostumeSnapshot, Product } from "../types";
import type { CostumePriceSummary, KitDefinition, KitOptions, KitSelection, KitSummary, KitView } from "./types";

export type * from "./types";

function validPrice(product: Product): boolean {
  return product.currency === "USD" && Number.isSafeInteger(product.priceCents) && product.priceCents >= 0;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function priceSummary(snapshot: CostumeSnapshot): CostumePriceSummary {
  const products = new Map(snapshot.products.map((product) => [product.id, product]));
  let required = 0;
  let full = 0;
  let defaults = 0;
  let missingRequired = false;
  let missingDefault = false;
  let unknownStockCount = 0;
  let unavailablePieceCount = 0;
  for (const piece of snapshot.pieces) {
    const options = piece.matches.flatMap(({ productId }) => {
      const product = products.get(productId);
      return product && validPrice(product) && product.availability !== "out_of_stock" ? [product] : [];
    }).sort((a, b) => a.priceCents - b.priceCents || a.id.localeCompare(b.id));
    const cheapest = options[0];
    if (cheapest) {
      full += cheapest.priceCents;
      if (piece.required) required += cheapest.priceCents;
      if (cheapest.availability === "unknown") unknownStockCount++;
    } else {
      unavailablePieceCount++;
      if (piece.required) missingRequired = true;
    }
    const defaultId = piece.matches.find(({ rank }) => rank === 0)?.productId;
    const defaultProduct = defaultId ? products.get(defaultId) : undefined;
    if (defaultProduct && validPrice(defaultProduct)) defaults += defaultProduct.priceCents;
    else missingDefault = true;
  }
  return {
    costumeSlug: snapshot.costume.slug,
    requiredSubtotalCents: missingRequired ? null : required,
    fullSubtotalCents: unavailablePieceCount ? null : full,
    defaultSubtotalCents: missingDefault ? null : defaults,
    unknownStockCount,
    unavailablePieceCount,
  };
}

/** Pure, synchronous helpers accept catalog records, and work in either module graph. */
export function summarizeCostumes(snapshots: CostumeSnapshot[]): CostumePriceSummary[] {
  return snapshots.map(priceSummary);
}

/** Publication checks are also reusable by the read-only verification script. */
export function validateKit(definition: KitDefinition, snapshots: CostumeSnapshot[]): string[] {
  const errors: string[] = [];
  const fail = (message: string) => errors.push(`${definition.slug}: ${message}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(definition.slug)) fail("invalid slug");
  if (!definition.name?.trim() || !definition.description?.trim() || !definition.rationale?.trim()) fail("missing description or rationale");
  const snapshot = snapshots.find(({ costume }) => costume.slug === definition.costumeSlug);
  if (!snapshot) return [...errors, `${definition.slug}: costume not found`];
  const pieces = new Map(snapshot.pieces.map((piece) => [piece.id, piece]));
  const products = new Map(snapshot.products.map((product) => [product.id, product]));
  const merchants = new Set(snapshot.merchants.map(({ id }) => id));
  const disposition = new Set<string>();
  for (const entry of [...definition.buy, ...definition.owned, ...definition.skipped]) {
    if (!pieces.has(entry.pieceId)) fail(`unknown piece ${entry.pieceId}`);
    if (disposition.has(entry.pieceId)) fail(`piece has more than one disposition: ${entry.pieceId}`);
    disposition.add(entry.pieceId);
  }
  for (const piece of snapshot.pieces) {
    if (!disposition.has(piece.id)) fail(`piece has no disposition: ${piece.id}`);
  }
  for (const entry of definition.buy) {
    const product = products.get(entry.productId);
    if (!product || !pieces.get(entry.pieceId)?.matches.some(({ productId }) => productId === entry.productId)) {
      fail(`product is not a validated match: ${entry.productId}`);
    } else {
      if (!validPrice(product)) fail(`invalid USD price: ${entry.productId}`);
      if (!merchants.has(product.merchantId)) fail(`merchant not found: ${entry.productId}`);
      if (!Number.isFinite(Date.parse(product.checkedAt))) fail(`missing product check date: ${entry.productId}`);
    }
    if (!Number.isSafeInteger(entry.quantity ?? 1) || (entry.quantity ?? 1) < 1) fail("quantity must be a positive integer");
  }
  if (!definition.buy.length) fail("kit must include a new piece");
  if (!definition.owned.length) fail("kit must state its owned basics");
  for (const entry of definition.owned) if (!entry.note?.trim()) fail(`owned piece needs a note: ${entry.pieceId}`);
  for (const entry of definition.skipped) {
    if (pieces.get(entry.pieceId)?.required) fail(`required piece cannot be skipped: ${entry.pieceId}`);
    if (!entry.reason?.trim()) fail(`skipped piece needs a reason: ${entry.pieceId}`);
  }
  if (!Number.isSafeInteger(definition.assembly.minutes) || definition.assembly.minutes < 0) fail("assembly minutes must be nonnegative");
  if (!definition.assembly.steps.length) fail("assembly steps must be explicit");
  if (!definition.readiness.notes.length) fail("readiness notes must be explicit");
  if (!definition.readiness.evidence.length) fail("missing research evidence");
  for (const evidence of definition.readiness.evidence) {
    try { if (new URL(evidence.url).protocol !== "https:") fail("evidence must use HTTPS"); }
    catch { fail("invalid evidence URL"); }
    if (!Number.isFinite(Date.parse(evidence.checkedAt))) fail("invalid evidence check date");
    if (!["product", "shipping", "pickup", "assembly"].includes(evidence.kind)) fail("unknown evidence kind");
    if (!evidence.note?.trim()) fail("evidence needs a factual note");
    if (evidence.productId && !definition.buy.some(({ productId }) => productId === evidence.productId)) fail("evidence references a product outside the purchased kit");
    if (evidence.earliestArrivalDate && (evidence.kind !== "shipping" || !validDate(evidence.earliestArrivalDate))) fail("arrival constraint requires a valid shipping date");
  }
  return errors;
}

/** Returns null for retired references, keeping unrelated catalog cards usable. */
export function resolveKit(definition: KitDefinition, snapshots: CostumeSnapshot[], options: KitOptions = {}): KitView | null {
  if (options.eventDate && !validDate(options.eventDate)) throw new Error("Use a valid event date in YYYY-MM-DD form.");
  if (validateKit(definition, snapshots).length) return null;
  const snapshot = snapshots.find(({ costume }) => costume.slug === definition.costumeSlug)!;
  const pieces = new Map(snapshot.pieces.map((piece) => [piece.id, piece]));
  const products = new Map(snapshot.products.map((product) => [product.id, product]));
  const merchants = new Map(snapshot.merchants.map((merchant) => [merchant.id, merchant]));
  const buy = definition.buy.map((entry) => {
    const product = products.get(entry.productId)!;
    return { piece: pieces.get(entry.pieceId)!, product, merchant: merchants.get(product.merchantId)!, quantity: entry.quantity ?? 1 };
  });
  const owned = definition.owned.map(({ pieceId, note }) => ({ piece: pieces.get(pieceId)!, note }));
  const skipped = definition.skipped.map(({ pieceId, reason }) => ({ piece: pieces.get(pieceId)!, reason }));
  const tooLateProductIds = options.eventDate ? [...new Set(definition.readiness.evidence.flatMap((evidence) => {
    if (!evidence.earliestArrivalDate || evidence.earliestArrivalDate <= options.eventDate!) return [];
    return evidence.productId ? [evidence.productId] : buy.map(({ product }) => product.id);
  }))] : [];
  const deliveryStatus = tooLateProductIds.length ? "known_too_late" : definition.readiness.evidence.some(({ kind }) => kind === "pickup") ? "pickup_option_found" : "delivery_unconfirmed";
  const purchaseSubtotalCents = buy.reduce((sum, { product, quantity }) => sum + product.priceCents * quantity, 0);
  const pricing = priceSummary(snapshot);
  const outOfStockCount = buy.filter(({ product }) => product.availability === "out_of_stock").length;
  const checkDates = buy.map(({ product }) => product.checkedAt).sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    slug: definition.slug,
    costumeSlug: definition.costumeSlug,
    name: definition.name,
    description: definition.description,
    image: snapshot.costume.image,
    alt: snapshot.costume.alt,
    purchaseSubtotalCents,
    fullSubtotalCents: pricing.fullSubtotalCents,
    defaultSubtotalCents: pricing.defaultSubtotalCents,
    savingsCents: pricing.defaultSubtotalCents === null ? null : pricing.defaultSubtotalCents - purchaseSubtotalCents,
    purchaseCount: buy.reduce((sum, { quantity }) => sum + quantity, 0),
    ownedCount: owned.length,
    skippedCount: skipped.length,
    shopCount: new Set(buy.map(({ merchant }) => merchant.id)).size,
    unknownStockCount: buy.filter(({ product }) => product.availability === "unknown").length,
    outOfStockCount,
    oldestCheckedAt: checkDates[0] ?? null,
    assemblyMinutes: definition.assembly.minutes,
    ownedBasics: owned.map(({ note }) => note),
    supplies: [...definition.extraSupplies],
    deliveryStatus,
    eligible: !outOfStockCount && !tooLateProductIds.length,
    definition,
    buy,
    owned,
    skipped,
    readiness: { status: deliveryStatus, eventDate: options.eventDate ?? null, tooLateProductIds, notes: [...definition.readiness.notes], evidence: definition.readiness.evidence },
  };
}

export function getKit(slug: string, snapshots: CostumeSnapshot[], options: KitOptions = {}): KitView | null {
  const definition = KITS.find((kit) => kit.slug === slug || kit.costumeSlug === slug);
  return definition ? resolveKit(definition, snapshots, options) : null;
}

export function listKits(snapshots: CostumeSnapshot[], options: KitOptions = {}): KitSummary[] {
  return KITS.flatMap((definition) => {
    const kit = resolveKit(definition, snapshots, options);
    if (!kit) return [];
    const summary: KitSummary = {
      slug: kit.slug, costumeSlug: kit.costumeSlug, name: kit.name,
      description: kit.description, image: kit.image, alt: kit.alt,
      purchaseSubtotalCents: kit.purchaseSubtotalCents, fullSubtotalCents: kit.fullSubtotalCents,
      defaultSubtotalCents: kit.defaultSubtotalCents, savingsCents: kit.savingsCents,
      purchaseCount: kit.purchaseCount, ownedCount: kit.ownedCount, skippedCount: kit.skippedCount,
      shopCount: kit.shopCount, unknownStockCount: kit.unknownStockCount, outOfStockCount: kit.outOfStockCount,
      oldestCheckedAt: kit.oldestCheckedAt, assemblyMinutes: kit.assemblyMinutes,
      ownedBasics: kit.ownedBasics, supplies: kit.supplies,
      deliveryStatus: kit.deliveryStatus, eligible: kit.eligible,
    };
    return [summary];
  });
}

/** Owned and skipped pieces have no product ID and cannot become chargeable rows. */
export function kitSelections(kit: KitView): KitSelection[] {
  if (!kit.eligible) throw new Error("This kit includes an unavailable or known-too-late piece. Choose a replacement first.");
  return [
    ...kit.buy.map(({ piece, product }) => ({ pieceId: piece.id, status: "selected" as const, productId: product.id })),
    ...kit.owned.map(({ piece }) => ({ pieceId: piece.id, status: "owned" as const })),
    ...kit.skipped.map(({ piece }) => ({ pieceId: piece.id, status: "skipped" as const })),
  ];
}
