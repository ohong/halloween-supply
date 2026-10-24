import type { PieceSeed } from "../seeds";

export const seeds: PieceSeed[] = [
  { id: "vampire-cape", name: "Black velvet cape", category: "Outerwear", required: true, sizeKind: "one_size" },
  { id: "ruffled-shirt", name: "White ruffled shirt", category: "Tops", required: true, sizeKind: "apparel" },
  { id: "black-waistcoat", name: "Black waistcoat — wear with your own black trousers", category: "Tailoring", required: true, sizeKind: "apparel" },
  { id: "vampire-boots", name: "Black tall boots", category: "Footwear", required: true, sizeKind: "shoe" },
  { id: "silver-brooch", name: "Silver brooch", category: "Accessories", required: true, sizeKind: "one_size" },
];

// Current stock and USD prices verified against the merchants' own product APIs.
// Product pages remain the source for materials, fit, photography, and checkout.
export const products: Record<string, Array<[string, string, string?]>> = {
  "vampire-cape": [
    ["https://mostlydead.com/products/velvet-cape-with-embossed-red-lining", "Velvet Cape with Embossed Red Lining"],
    ["https://caufields.com/products/hooded-velvet-cape-with-red-lining", "Hooded Velvet Cape with Red Lining"],
    ["https://caufields.com/products/black-velvet-cape-with-collar", "Black Velvet Cape with Collar"],
    ["https://caufields.com/products/63-deluxe-velvet-satin-hooded-cape-red-black", "Deluxe Velvet and Satin Hooded Cape Red Black"],
  ],
  "ruffled-shirt": [
    ["https://historicalemporium.com/products/bard-shirt-white", "Bard Ruffled Shirt White"],
    ["https://historicalemporium.com/products/raleigh-shirt-white", "Raleigh Ruffled Shirt White"],
    ["https://historicalemporium.com/products/emmeline-ruffle-blouse-white", "Emmeline Ruffle Blouse White"],
    ["https://historicalemporium.com/products/selma-ruffle-blouse-white", "Selma Ruffle Blouse White"],
  ],
  "black-waistcoat": [
    ["https://historicalemporium.com/products/fairfax-regency-vest-black", "Fairfax Regency Vest Black"],
    ["https://historicalemporium.com/products/gramercy-velvet-vest-black", "Gramercy Velvet Vest Black"],
    ["https://historicalemporium.com/products/godfrey-double-breasted-vest-black-brocade", "Godfrey Double Breasted Vest Black Brocade"],
    ["https://historicalemporium.com/products/skagway-vest-black", "Skagway Vest Black"],
  ],
  "vampire-boots": [
    ["https://historicalemporium.com/products/mid-calf-riding-boots-black", "Mid Calf Riding Boots Black"],
    ["https://historicalemporium.com/products/long-leather-cavalry-boots-black", "Long Leather Cavalry Boots Black"],
    ["https://historicalemporium.com/products/mens-faux-leather-sky-pilot-boots-black", "Sky Pilot Faux Leather Boots Black"],
    ["https://historicalemporium.com/products/distressed-faux-leather-brigand-boots-black", "Distressed Faux Leather Brigand Boots Black"],
  ],
  "silver-brooch": [
    ["https://historicalemporium.com/products/sunburst-magnetic-brooch-silver", "Sunburst Magnetic Brooch Silver"],
    ["https://www.celticcrystaldesign.com/products/vintage-sytle-celtic-brooch", "Vintage Style Celtic Brooch in Sterling Silver"],
    ["https://www.celticcrystaldesign.com/products/antheia-celtic-marcasite-brooch", "Antheia Celtic Marcasite Brooch"],
    ["https://www.celticcrystaldesign.com/products/cella-celtic-marcasite-brooch", "Cella Celtic Marcasite Brooch in Sterling Silver"],
  ],
};
