// Merchant product pages discovered from live independent-store catalogs.
// These supplement Google Shopping cards that link back to Google instead of the shop.
import type { Candidate } from "./search";

const products: Record<string, Array<[string, string, string?]>> = {
  "cowboy-hat": [
    ["https://eastnwestlabel.com/products/metallic-cowboy-hat", "Metallic Cowboy Hat", "Silver"],
    ["https://wilderwest.com/products/stetson-john-wayne-peacemaker-4x-wool-cowboy-hat", "Stetson John Wayne Peacemaker Cowboy Hat", "Stone"],
    ["https://eastnwestlabel.com/products/charmed-cowboy-hat-copy", "Charmed Cowboy Hat", "White"],
  ],
  "fringe-jacket": [
    ["https://www.pretty-attitude.com/products/beige-faux-suede-fringe-jacket", "Beige Faux Suede Fringe Jacket"],
    ["https://www.pretty-attitude.com/products/black-jacket-with-fringe", "Black Faux Suede Moto Jacket with Fringe"],
    ["https://shopcindyjane.com/products/black-star-faux-leather-fringe-moto-jacket", "Black Star Faux Leather Fringe Moto Jacket"],
  ],
  "silver-trousers": [
    ["https://fringe-co.com/products/silver-high-waisted-sequin-party-pant", "Silver High Waisted Sequin Party Pant"],
    ["https://shaynagibbonskeeley.com/products/metallic-silver-straight", "Metallic Silver Straight"],
    ["https://www.shophubbardhouse.com/products/lupe-metallic-pants", "Lupe Metallic Pants"],
    ["https://thelocalgroup.shop/products/metallic-muse-satin-trouser-in-silver", "Metallic Muse Satin Trouser in Silver"],
    ["https://www.pretty-attitude.com/products/metallic-bell-bottom-jean-in-black-denim", "Metallic Bell Bottom Jean in Black Denim"],
  ],
  "western-boots": [
    ["https://www.pretty-attitude.com/products/ponsies-boot", "Ponsies Embroidered Cowboy Calf Boots", "Silver"],
    ["https://shopcindyjane.com/products/metallic-silver-cowgirl-boots", "Metallic Silver Cowgirl Boots"],
    ["https://www.pretty-attitude.com/products/dolly-black-fringe-cowboy-boots", "Dolly Black Fringe Cowboy Boots"],
    ["https://www.pretty-attitude.com/products/ponsies-boot", "Ponsies Embroidered Cowboy Calf Boots", "Ecru"],
  ],
  "neckerchief": [
    ["https://wilderwest.com/products/white-paisley-bandana", "Royal Blue Paisley Bandana", "ROYAL BLUE"],
    ["https://standardandstrange.com/products/reveal-kojima-bandanna-blue", "Reveal Kojima Bandanna Blue"],
    ["https://cowtownwildrags.com/products/solid-buckaroo-blue-wild-rag", "Buckaroo Blue Silk Wild Rag"],
    ["https://cowtownwildrags.com/products/cowtown-classic-blue-silk-wild-rag", "Cowtown Classic Blue Paisley Silk Wild Rag"],
    ["https://cowtownwildrags.com/products/paisley-blue-bandana-hondo", "Hondo Paisley Blue Silk Wild Rag"],
  ],
};

export function curatedCandidates(pieceId: string): Candidate[] {
  return (products[pieceId] ?? []).map(([url, title, preferredColor]) => ({
    url, title, via: "organic", source: "merchant catalog discovery", preferredColor,
  }));
}

/** Locations verified on each merchant's official address page during sourcing. */
export function researchedMerchantLocation(url: string): { name: string; city: string; neighborhood: string; evidence: string } | null {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (host === "wilderwest.com") return {
    name: "Wilder West", city: "San Francisco", neighborhood: "Fisherman's Wharf",
    evidence: "https://wilderwest.com/products/stetson-john-wayne-peacemaker-4x-wool-cowboy-hat — Pier 39, Building P, Level 1, San Francisco CA 94133",
  };
  if (host === "standardandstrange.com") return {
    name: "Standard & Strange", city: "Berkeley", neighborhood: "West Berkeley",
    evidence: "https://standardandstrange.com/pages/visit-us — 755 Hearst Avenue, Berkeley CA 94710",
  };
  return null;
}
