import type { PieceSeed } from "../seeds";

export const seeds: PieceSeed[] = [
  { id: "ghost-linen-drape", name: "Off-white linen sheet to drape", category: "Fabric", required: true, sizeKind: "one_size" },
  { id: "ghost-light-top", name: "Comfortable light base top", category: "Tops", required: true, sizeKind: "apparel" },
  { id: "ghost-base-pants", name: "Comfortable light base pants", category: "Bottoms", required: true, sizeKind: "pants" },
  { id: "brown-lace-up-boots", name: "Brown leather lace-up boots", category: "Footwear", required: true, sizeKind: "shoe" },
  { id: "ghost-drape-fastener", name: "Optional shawl pin or drape fastener", category: "Accessories", required: false, sizeKind: "one_size" },
];

// These are regular garments and an uncut sheet. Drape the linen over the shoulders;
// the customer adjusts the fit. No pre-cut eye openings or sewing service is included.
export const products: Record<string, Array<[string, string, string?]>> = {
  "ghost-linen-drape": [
    ["https://www.roughlinen.com/products/orkney-linen-flat-sheet", "Orkney Linen Flat Sheet", "off-white"],
    ["https://magiclinen.com/products/natural-linen-flat-sheet", "Natural Linen Flat Sheet", "US"],
    ["https://linenshed.us/products/bed-linen-flat-sheet-natural-undyed", "Natural Undyed Linen Flat Sheet"],
  ],
  "ghost-light-top": [
    ["https://harvestandmill.com/products/mens-crew", "Organic Cotton Crew Tee in Natural"],
    ["https://groceriesapparel.com/products/willy-tee", "Willa Tee in No-bleach White", "No-bleach White"],
    ["https://larelaxed.com/products/needlepoint-tee", "Needlepoint Tee in White", "White"],
  ],
  "ghost-base-pants": [
    ["https://harvestandmill.com/products/mens-organic-straight-leg-lounge-pants-in-natural", "Organic Straight Leg Lounge Pants in Natural"],
    ["https://groceriesapparel.com/products/hemp-pant", "Hemp Pant in No-bleach White", "No-bleach White"],
    ["https://larelaxed.com/products/linen-drawstring-pant", "Linen Drawstring Pant in White", "White"],
  ],
  "brown-lace-up-boots": [
    ["https://thursdayboots.com/products/mens-brown-captain", "Captain Lace-up Boots in Brown", "Standard"],
    ["https://helmboots.com/products/the-zind-saddle-brown", "The Zind Lace-up Boots in Saddle Brown", "Standard (D)"],
    ["https://grantstoneshoes.com/products/diesel-boot-saddle-tan", "Diesel Lace-up Boots in Saddle Tan", "D (Standard)"],
  ],
  "ghost-drape-fastener": [
    ["https://www.needlesnpinsyarnshoppe.com/products/white-brass-shawl-pin", "White Brass Shawl Pin", "Round"],
    ["https://www.needlesnpinsyarnshoppe.com/products/wood-off-center-shawl-pin", "Rosewood Off-Center Shawl Pin"],
    ["https://threadandmaple.com/products/leather-snap-shawl-cuff", "Leather Snap Shawl Cuff", "Whiskey"],
  ],
};
