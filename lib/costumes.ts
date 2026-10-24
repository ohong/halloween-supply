import type { CostumeStatus } from "./types";

/** Home tiles and fallback copy. Only entries with status "live" have a shop page. */
export const costumes = [
  {
    slug: "cosmic-cowboy",
    name: "Cosmic Cowboy",
    description: "Silver western wear with fringe, pointed boots, and a blue neckerchief.",
    status: "live",
    image: "/costumes/cosmic-cowboy.png",
    alt: "Metallic silver cowboy hat, fringed western jacket, silver trousers and boots with a blue neckerchief",
    pieces: ["A silver cowboy hat", "A metallic or sequined fringed jacket", "Silver trousers", "Pointed western boots", "A bright blue neckerchief"],
    tip: "Start with a thrifted western jacket. Silver fabric and fringe can turn a familiar silhouette into something otherworldly.",
  },
  {
    slug: "velvet-vampire",
    name: "Velvet Vampire",
    description: "A black velvet cape with oxblood lining, a ruffled shirt, and a tailored waistcoat.",
    status: "coming_soon",
    image: "/costumes/velvet-vampire.png",
    alt: "Black velvet vampire cape with burgundy lining, a ruffled shirt, waistcoat, trousers, and black boots",
    pieces: ["A black cape with a high collar", "A white ruffled shirt", "A black waistcoat and tailored trousers", "Black ankle boots", "A small silver brooch"],
    tip: "Borrow the shirt and trousers from your everyday wardrobe. Let the cape do the talking.",
  },
  {
    slug: "moon-moth",
    name: "Moon Moth",
    description: "A sage and cream wing cape over a dark jumpsuit, with a soft collar and antennae.",
    status: "coming_soon",
    image: "/costumes/moon-moth.png",
    alt: "Sage green and cream moth wing cape with eye spots, a fuzzy collar, antennae, and a charcoal jumpsuit",
    pieces: ["A moth wing cape in sage or cream", "A dark fitted jumpsuit", "A soft faux-fur collar", "An antenna headband", "Comfortable dark shoes"],
    tip: "Keep the base outfit simple. The wing shape and eye spots make the costume immediately readable.",
  },
  {
    slug: "linen-ghost",
    name: "Linen Ghost",
    description: "An off-white linen sheet with two eye openings and brown lace-up boots.",
    status: "coming_soon",
    image: "/costumes/linen-ghost.png",
    alt: "An off-white linen ghost costume with two oval eye openings, a flowing scalloped hem, and brown lace-up boots",
    pieces: ["A large piece of off-white linen or an old sheet", "Two carefully positioned eye openings", "Comfortable clothes underneath", "Your favorite lace-up boots"],
    tip: "Pin and try on the fabric before cutting. Keep the eye openings clear and the hem above your shoes.",
  },
  {
    slug: "woodland-mushroom",
    name: "Woodland Mushroom",
    description: "A red felt mushroom cap, cream blouse, and brown corduroy overalls.",
    status: "coming_soon",
    image: "/costumes/woodland-mushroom.png",
    alt: "A rust-red spotted mushroom cap hat with cream blouse, brown corduroy overalls, cream tights, and leather boots",
    pieces: ["An oversized red mushroom cap hat", "Cream felt spots for the cap", "A cream puff-sleeve blouse", "Brown corduroy overalls", "Cream tights and brown boots"],
    tip: "Build a lightweight cap around a comfortable hat. Felt spots and pleated cream fabric underneath add the finishing detail.",
  },
] as const satisfies readonly {
  slug: string;
  name: string;
  description: string;
  status: CostumeStatus;
  image: string;
  alt: string;
  pieces: readonly string[];
  tip: string;
}[];

export type CostumeTile = (typeof costumes)[number];

export function getLiveCostumeTile(slug: string): CostumeTile | undefined {
  return costumes.find((c) => c.slug === slug && c.status === "live");
}
