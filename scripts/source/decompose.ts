// Step 1: Claude structured output turns a costume into pieces with search queries.
import { z } from "zod";
import { askObject } from "../../lib/sourcing/llm";
import type { Piece, SizeKind } from "../../lib/types";
import { PIECE_SEEDS } from "./seeds";

export interface CostumeSource {
  slug: string;
  name: string;
  description: string;
  pieces: readonly string[];
  tip?: string;
}

const SIZE_KINDS = ["apparel", "pants", "shoe", "hat", "one_size"] as const;

export const slugify = (s: string) =>
  s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export async function decompose(costume: CostumeSource): Promise<Piece[]> {
  const seeds = PIECE_SEEDS[costume.slug];
  const schema = z.object({
    pieces: z.array(
      z.object({
        id: z.string().describe(seeds ? "Echo the given id exactly." : "Stable kebab-case id such as cowboy-hat."),
        name: z.string(),
        category: z.string().describe("Headwear, Outerwear, Tops, Bottoms, Footwear, Accessories, ..."),
        required: z.boolean(),
        styleNotes: z.string().describe("One or two sentences on the look: colour, material, era, silhouette."),
        queries: z.array(z.string()).describe("2 or 3 Google Shopping style queries, each naming the item, colour and material."),
        sizeKind: z.enum(SIZE_KINDS),
      }),
    ),
  });

  const seedBlock = seeds
    ? `Use exactly these pieces, in this order, keeping each id unchanged:\n${seeds
        .map((s) => `- id=${s.id} | ${s.name} | category=${s.category} | required=${s.required} | sizeKind=${s.sizeKind}`)
        .join("\n")}`
    : `Existing piece ideas (turn each into one piece):\n${costume.pieces.map((p) => `- ${p}`).join("\n")}`;

  const out = await askObject({
    label: `decompose:${costume.slug}`,
    schema,
    instructions:
      "You plan a Halloween costume assembled from individual pieces bought from independent merchants (Etsy shops, vintage and secondhand stores, niche direct-to-consumer brands). " +
      "Write search queries a human would type into Google Shopping to find those pieces. Favour wording that surfaces vintage, handmade or small-brand listings " +
      "(for example 'vintage', 'handmade', 'western wear', 'Etsy'). Never name big-box retailers.",
    prompt: `Costume: ${costume.name}\nDescription: ${costume.description}\n${costume.tip ? `Tip: ${costume.tip}\n` : ""}\n${seedBlock}\n\nReturn the pieces with styleNotes and 2 to 3 queries each.`,
  });

  const pieces: Piece[] = [];
  const list = seeds ?? out.pieces.map((p) => ({ id: slugify(p.id || p.name), name: p.name, category: p.category, required: p.required, sizeKind: p.sizeKind as SizeKind }));
  list.forEach((seed, i) => {
    const got = out.pieces.find((p) => p.id === seed.id) ?? out.pieces[i];
    const queries = (got?.queries ?? []).map((q) => q.trim()).filter(Boolean).slice(0, 3);
    pieces.push({
      id: seed.id,
      name: seed.name,
      category: seed.category,
      required: seed.required,
      order: i + 1,
      styleNotes: got?.styleNotes ?? "",
      queries: queries.length ? queries : [seed.name],
      sizeKind: seed.sizeKind,
    });
  });
  return pieces;
}
