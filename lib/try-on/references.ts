import "server-only";
import { readMirrorInventory } from "../live-mirror/catalog-server";
import { composeMirrorCostume } from "../live-mirror/mixed-outfit";
import { readCustomLook } from "../custom-looks/store";
import { costumes } from "../costumes";
import { PreviewError } from "../ai/openai";
import type { MirrorMix } from "../live-mirror/types";

export interface PreviewSelection {
  costumeSlug?: string; savedLookId?: string;
  selected: { pieceId: string; productId: string }[]; owned: string[]; skipped: string[]; mixes: MirrorMix[];
}
/** Only server catalog or saved records can supply product details and references. */
export async function resolvePreviewReferences(input: PreviewSelection) {
  const { selected, owned, skipped, mixes } = input;
  const ids = [...selected.map(item => item.pieceId), ...owned, ...skipped];
  if (new Set(ids).size !== ids.length) throw new PreviewError(400, "Choose each outfit piece only once.");
  if (Boolean(input.costumeSlug) === Boolean(input.savedLookId)) throw new PreviewError(400, "Choose one saved look or gallery costume.");
  const referenceSources: string[] = [], descriptions: string[] = [], ownedNames: string[] = [], skippedNames: string[] = [];
  if (input.savedLookId) {
    if (mixes.length || owned.length || skipped.length) throw new PreviewError(400, "Saved product boards use their found products only.");
    const look = await readCustomLook(input.savedLookId);
    if (!look) throw new PreviewError(404, "This saved look could not be found. Reopen your board and try again.");
    const found = look.pieces.flatMap(row => row.item ? [row.item] : []);
    if (!found.length || look.state === "running") throw new PreviewError(400, "Wait for this look to finish finding products.");
    const choices = selected.length ? selected : found.map(item => ({ pieceId: item.pieceId, productId: item.productId }));
    if (choices.length !== found.length || choices.some(choice => !found.some(item => item.pieceId === choice.pieceId && item.productId === choice.productId))) throw new PreviewError(400, "The saved products changed. Reopen your board before previewing.");
    // Merchant photos can show another person. Use the saved product names only;
    // never fetch arbitrary remote URLs or use another face as an identity input.
    descriptions.push(...found.map(item => `${item.pieceName}: ${item.title} (text reference only)`));
    return { costume: { slug: `saved-${look.id}`, name: look.name, description: look.summary, pieces: look.pieces.map(row => row.piece.name) },
      productPreview: true, referenceSources, descriptions, ownedNames, skippedNames, savedLookId: look.id };
  }
  const costume = costumes.find(item => item.slug === input.costumeSlug);
  if (!costume) throw new PreviewError(400, "Choose a costume from the gallery.");
  if (mixes.length && !ids.length) throw new PreviewError(400, "Include a choice for every mixed outfit piece.");
  if (ids.length) {
    const inventory = await readMirrorInventory();
    const base = inventory.views.find(view => view.costume.slug === costume.slug);
    if (!base) throw new PreviewError(400, "This costume is unavailable.");
    let view;
    try { view = composeMirrorCostume(base, mixes, inventory.views); }
    catch (error) { throw new PreviewError(400, error instanceof Error ? error.message : "Invalid mixed outfit."); }
    if (ids.some(id => !view.pieces.some(({ piece }) => piece.id === id))) throw new PreviewError(400, "Some outfit pieces are no longer in this costume.");
    if (view.pieces.some(({ piece }) => !ids.includes(piece.id))) throw new PreviewError(400, "Include a choice for every outfit piece.");
    for (const { piece, options } of view.pieces) {
      if (owned.includes(piece.id)) { ownedNames.push(piece.name); continue; }
      if (skipped.includes(piece.id)) {
        if (piece.required) throw new PreviewError(400, "Required costume pieces cannot be skipped.");
        skippedNames.push(piece.name); continue;
      }
      const choice = selected.find(item => item.pieceId === piece.id);
      const option = options.find(({ product }) => product.id === choice?.productId);
      if (!option || option.product.availability === "out_of_stock") throw new PreviewError(400, "A selected product is unavailable. Choose another outfit first.");
      const garmentImage = option.product.cutout;
      const hasImage = Boolean(garmentImage?.startsWith("/products/"));
      descriptions.push(`${piece.name}: ${option.product.title}. ${option.product.description.slice(0, 700)}${hasImage ? ` (reference image ${referenceSources.length + 2})` : " (text reference only)"}`);
      if (hasImage) referenceSources.push(garmentImage!);
    }
  }
  return { costume, productPreview: ids.length > 0, referenceSources, descriptions, ownedNames, skippedNames };
}
