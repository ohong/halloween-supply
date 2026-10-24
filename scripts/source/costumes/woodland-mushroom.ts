import type { PieceSeed } from "../seeds";

export const seeds: PieceSeed[] = [
  { id: "mushroom-hat", name: "Red spotted mushroom hat", category: "Headwear", required: true, sizeKind: "one_size" },
  { id: "cream-blouse", name: "Cream blouse", category: "Tops", required: true, sizeKind: "apparel" },
  { id: "brown-corduroy-overalls", name: "Brown corduroy overalls", category: "Bottoms", required: true, sizeKind: "pants" },
  { id: "cream-tights", name: "Cream tights", category: "Hosiery", required: true, sizeKind: "apparel" },
  { id: "brown-boots", name: "Brown boots", category: "Footwear", required: true, sizeKind: "shoe" },
];

// Discovered on live merchant pages, then checked against each shop's public
// product variant feed. The pipeline checks stock, USD prices and imagery again.
export const products: Record<string, Array<[string, string, string?]>> = {
  "mushroom-hat": [
    ["https://www.bandofthewild.com/products/adult-mushroom-hat", "Handmade Adult Mushroom Hat", "Hat"],
    ["https://heartfeltlayers.com/products/red-mushroom-beret-hand-felted-wool-hat", "Red Mushroom Beret - Hand Felted Wool Hat"],
    ["https://behumblemushrooms.com/products/original-handmade-wool-felt-beret-with-small-mushrooms", "Wool Felt Beret With Small Mushroom Hat"],
  ],
  "cream-blouse": [
    ["https://imasfashions.com/products/tru-luxe-embroidered-dolman-sleeve-button-up-shirt-ivory", "Ivory Embroidered Dolman Sleeve Blouse"],
    ["https://us.snagtights.com/products/textured-woven-blouse-cream", "Iona Textured Woven Blouse - Cream"],
    ["https://www.unique-vintage.com/products/unique-vintage-ivory-peacock-feather-embossed-gwen-blouse", "Ivory Peacock Feather Embossed Gwen Blouse"],
  ],
  "brown-corduroy-overalls": [
    ["https://ylistyle.com/products/retro-brown-corduroy-overalls-women-c1830", "Brown Cotton Corduroy Overalls", "Brown"],
    ["https://goldenhourgiftco.com/products/classic-brown-corduroy-overalls", "Classic Brown Corduroy Overalls"],
    ["https://www.shopbmaes.com/products/brown-corduroy-overalls", "Brown Corduroy Overalls"],
    ["https://www.vicicollection.com/products/cassidie-corduroy-overalls", "Cassidie Corduroy Overalls", "Brown"],
  ],
  "cream-tights": [
    ["https://snagtights.us/products/merino-wool-tights-v2-grannies-oatmeal", "Grannies Cable Knit Wool Tights - Oatmeal"],
    ["https://sockdreams.com/products/color-tights", "Color Tights - Ivory", "Ivory"],
    ["https://sockdreams.com/products/plus-size-color-tights", "Plus Size Color Tights - Ivory", "Ivory"],
  ],
  "brown-boots": [
    ["https://www.lemsshoes.com/products/womens-boulder-boot-grip-waterproof", "Women's Boulder Boot Grip Waterproof - Dakota", "Dakota"],
    ["https://www.lemsshoes.com/products/womens-boulder-summit-waterproof", "Women's Boulder Summit Waterproof - Rugged Bark", "Rugged Bark"],
    ["https://www.lemsshoes.com/products/womens-chelsea-boot-waterproof", "Women's Chelsea Barefoot Boot Waterproof - Espresso", "Espresso"],
  ],
};
