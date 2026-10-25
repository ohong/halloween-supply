import { mixSchema } from "./mix-schema";
import { z } from "zod";
import type { CostumeView } from "@/lib/types";
import type { MirrorOutfit } from "./types";
import { appearanceSchema } from "./appearance-schema";

export const videoOutfitSchema = z.object({
  appearance: appearanceSchema.optional(),
  mixes: z.array(mixSchema).max(12).optional(),
  costumeSlug: z.string().min(1).max(100),
  selection: z.record(z.string().max(150), z.string().max(150)),
  uses: z.record(z.string().max(150), z.enum(["buy", "owned", "skip"])),
}).strict().superRefine((value, ctx) => {
  if (Object.keys(value.selection).length > 20 || Object.keys(value.uses).length > 20) ctx.addIssue({ code: "custom", message: "Too many pieces" });
});

export function videoOutfitRequest(costume: CostumeView, outfit: MirrorOutfit) {
  return {
    ...(outfit.appearance && Object.keys(outfit.appearance).length ? { appearance: outfit.appearance } : {}),
    costumeSlug: costume.costume.slug,
    ...(outfit.mixes?.length ? { mixes: outfit.mixes } : {}),
    selection: Object.fromEntries(costume.pieces.map(({ piece, options }) => [piece.id, outfit.selection[piece.id] ?? options[0]?.product.id ?? ""])),
    uses: Object.fromEntries(costume.pieces.map(({ piece }) => [piece.id, outfit.uses[piece.id] ?? "buy"])),
  };
}

/** Resolve IDs against our catalog; clients cannot supply image URLs or prompts. */
export function resolveVideoOutfit(costume: CostumeView, input: z.infer<typeof videoOutfitSchema>) {
  const known = new Set(costume.pieces.map(({ piece }) => piece.id));
  if ([...Object.keys(input.selection), ...Object.keys(input.uses), ...Object.keys(input.appearance ?? {})].some((id) => !known.has(id))) throw new Error("Some outfit pieces are no longer available.");
  const selected = [];
  const owned: string[] = [];
  const skipped: string[] = [];
  for (const { piece, options } of costume.pieces) {
    const use = input.uses[piece.id];
    if (!use) throw new Error("Include a choice for every outfit piece.");
    if (use === "owned") { owned.push(piece.name); continue; }
    if (use === "skip") {
      if (piece.required) throw new Error("Required costume pieces cannot be skipped.");
      skipped.push(piece.name); continue;
    }
    const option = options.find(({ product }) => product.id === input.selection[piece.id]);
    if (!option || option.product.availability === "out_of_stock") throw new Error("A selected product is unavailable. Choose another piece.");
    selected.push({ piece, product: option.product });
  }
  if (!selected.length) throw new Error("Choose at least one piece to try on in the live mirror.");
  const appearance = costume.pieces.flatMap(({ piece }) => {
    const edit = input.appearance?.[piece.id];
    return edit && input.uses[piece.id] !== "skip" ? [{ name: piece.name, ...edit }] : [];
  });
  return { selected, owned, skipped, appearance };
}

export function videoOutfitPrompt(outfit: ReturnType<typeof resolveVideoOutfit>) {
  // The complete desired outfit is sent every time: Decart set() replaces state.
  // Product cutouts provide details, leaving the prompt focused on regions.
  const names = outfit.selected.map(({ piece }) => piece.name).join(", ");
  const preserve = outfit.owned.length ? ` Keep the camera clothing for owned pieces: ${outfit.owned.join(", ")}.` : "";
  const skip = outfit.skipped.length ? ` Omit optional pieces: ${outfit.skipped.join(", ")}.` : "";
  const edits = outfit.appearance?.length ? ` Garment-only overrides: ${outfit.appearance.map(edit => `${edit.name}: ${[edit.color, edit.style].filter(Boolean).join(", ")}`).join("; ")}.` : "";
  const prompt = `Substitute the outfit with these reference-board garments: ${names}. Match their visible colors, fabrics and cuts.${preserve}${skip}${edits} Preserve the person's face, hair, body shape, skin tone, pose, background and lighting. Reference images are garments only, never identity references. Keep other camera clothing unchanged.`;
  if (prompt.length > 740) throw new Error("This outfit is too complex for the live mirror. Use photo try-on instead.");
  return prompt;
}
