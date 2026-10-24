import type { SizeKind } from "../../lib/types";
import { seeds as linenGhostSeeds } from "./costumes/linen-ghost";
import { seeds as vampireSeeds } from "./costumes/velvet-vampire";
import { seeds as mushroomSeeds } from "./costumes/woodland-mushroom";
import { seeds as mothSeeds } from "./costumes/moon-moth";

export interface PieceSeed {
  id: string;
  name: string;
  category: string;
  required: boolean;
  sizeKind: SizeKind;
}

/** Stable piece ids per costume. Pieces are shared across costumes, so ids never change. */
export const PIECE_SEEDS: Record<string, PieceSeed[]> = {
  "linen-ghost": linenGhostSeeds,
  "velvet-vampire": vampireSeeds,
  "woodland-mushroom": mushroomSeeds,
  "moon-moth": mothSeeds,
  "cosmic-cowboy": [
    { id: "cowboy-hat", name: "Silver cowboy hat", category: "Headwear", required: true, sizeKind: "hat" },
    { id: "fringe-jacket", name: "Metallic or sequined fringed jacket", category: "Outerwear", required: true, sizeKind: "apparel" },
    { id: "silver-trousers", name: "Silver trousers", category: "Bottoms", required: true, sizeKind: "pants" },
    { id: "western-boots", name: "Pointed western boots", category: "Footwear", required: true, sizeKind: "shoe" },
    { id: "neckerchief", name: "Bright blue neckerchief", category: "Accessories", required: false, sizeKind: "one_size" },
  ],
};
