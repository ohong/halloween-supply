import type { PieceSeed } from "../seeds";

export const seeds: PieceSeed[] = [
  { id: "moon-wing-cape", name: "Moth wing cape", category: "Outerwear", required: true, sizeKind: "one_size" },
  { id: "moon-unitard", name: "Dark fitted unitard", category: "Clothing", required: true, sizeKind: "apparel" },
  { id: "moon-fur-collar", name: "Soft ivory faux fur collar", category: "Accessories", required: true, sizeKind: "one_size" },
  { id: "moon-antennae", name: "Insect antenna headband", category: "Headwear", required: true, sizeKind: "one_size" },
  { id: "moon-boots", name: "Dark ankle boots", category: "Footwear", required: true, sizeKind: "shoe" },
];

// All pages below were checked against the merchant's public inventory. The
// currency parameter retains the merchant's USD presentment for overseas shops.
export const products: Record<string, Array<[string, string, string?]>> = {
  "moon-wing-cape": [
    ["https://www.costureroreal.es/products/luna-moth-wings-cape-adult-costume-chiffon-dance-shawl?currency=USD", "Luna Moth Wings Cape"],
    ["https://www.costureroreal.es/products/cecropia-moth-butterfly-cape-chiffon-cloak-dance-wings-costume-short-small-fairy?currency=USD", "Cecropia Moth Wing Cape"],
    ["https://www.costureroreal.es/products/moth-butterfly-cape-emperor-moth-cloak-dance-wings-costume-short-small-fairy?currency=USD", "Emperor Moth Wing Cape"],
  ],
  "moon-unitard": [
    ["https://losangelesapparel.net/products/83028gd-garment-dye-long-sleeve-unitard", "Garment Dye Long Sleeve Unitard", "Black"],
    ["https://losangelesapparel.net/products/vvt228-velvet-long-sleeve-unitard", "Velvet Long Sleeve Unitard", "Charcoal"],
    ["https://nooworks.com/products/unitard-black", "Unitard Black Activewear", "Black"],
  ],
  "moon-fur-collar": [
    ["https://jennafergracecollection.com/products/penny-blanc-faux-fur-collar?currency=USD", "Penny Blanc Ivory Faux Fur Collar"],
    ["https://fashionwearcanada.com/products/faux-fur-collar?currency=USD", "Faux Fur Collar", "Sand"],
    ["https://dejmo.com/products/fur-collar?currency=USD", "Faux Fur Collar", "Beige & Ivory"],
  ],
  "moon-antennae": [
    ["https://zuckerfeather.com/products/marabou-antenna-headband-w-lurex-black-silver-hbd-a-bl-ls-hbd-a-bl-ls", "Marabou Antenna Headband Black/Silver"],
    ["https://www.purecostumes.com/products/fm78998-butterfly-antenna-headband", "Butterfly Antenna Headband"],
    ["https://www.costume-shop.com/products/antenna-headband-1", "Antenna Headband"],
  ],
  "moon-boots": [
    ["https://www.tukshoes.com/products/black-brogue-airship-boot", "Black Brogue Airship Boot"],
    ["https://www.tukshoes.com/products/black-tukskin-lace-corset-pointed-creeper-boot", "Black TUKskin Lace Corset Pointed Creeper Boot"],
    ["https://www.tukshoes.com/products/black-leather-pull-on-western-pointed-mondo-creeper-boot", "Black Leather Pull On Western Pointed Mondo Creeper Boot"],
  ],
};
