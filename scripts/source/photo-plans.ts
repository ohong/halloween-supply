import type { NormalizeOptions } from "../../lib/sourcing/images";
import { photoPlans as vampirePhotos } from "./costumes/velvet-vampire.photos";
import { photoPlans as ghostPhotos } from "./costumes/linen-ghost.photos";
import { photoPlans as mothPhotos } from "./costumes/moon-moth.photos";
import { photoPlans as mushroomPhotos } from "./costumes/woodland-mushroom.photos";

export interface PhotoPlan extends Pick<NormalizeOptions, "crop" | "polygon" | "removeUpperSkin" | "skipRembg"> {
  /** A reviewed photo from this exact merchant product's gallery. */
  sourceUrl: string;
  /** Committed, visually reviewed silhouette. Force rebuilds keep these product details. */
  reviewedCutout?: string;
}

const cowboyPhotos: Record<string, PhotoPlan> = {
  "p-4b2c550c26": {
    "sourceUrl": "https://cdn.shopify.com/s/files/1/0579/7072/0791/products/ScreenShot2022-09-12at1.46.15PM.png?v=1663015669",
    "reviewedCutout": "public/products/p-4b2c550c26-cutout.png"
  },
  "p-5159210de3": {
    "sourceUrl": "https://cdn.shopify.com/s/files/1/0579/7072/0791/files/Screenshot2026-03-18at2.14.32PM.png?v=1773868568",
    "reviewedCutout": "public/products/p-5159210de3-cutout.png"
  },
  "p-2776c6bc82": {
    "sourceUrl": "https://cdn.shopify.com/s/files/1/0608/9326/6116/files/1540C0A7-860E-40A1-B7D2-831A3C91A3E2.jpg?v=1700951893",
    "reviewedCutout": "public/products/p-2776c6bc82-cutout.png"
  },
  "p-fac2225e1f": {
    "sourceUrl": "https://cdn.shopify.com/s/files/1/0940/5210/products/beige-fringe-jacket.jpg?v=1664649219",
    "reviewedCutout": "public/products/p-fac2225e1f-cutout.png"
  },
  "p-001ca783f4": {
    "sourceUrl": "https://cdn.shopify.com/s/files/1/0940/5210/files/24355708_439897ca-46d3-4044-a1e7-9aaccadb7351.jpg?v=1756259622",
    "reviewedCutout": "public/products/p-001ca783f4-cutout.png"
  },
  "p-bf85954bb6": {
    "sourceUrl": "https://cdn.shopify.com/s/files/1/0794/5139/0145/files/METALLICFRONTJEANS.png?v=1762198226",
    "reviewedCutout": "public/products/p-bf85954bb6-cutout.png"
  },
  "p-ba3ef9a46e": {
    "sourceUrl": "https://cdn.shopify.com/s/files/1/0757/5483/2096/files/Screenshot_2025-10-11_at_10.56.20_PM.png?v=1780688905",
    "reviewedCutout": "public/products/p-ba3ef9a46e-cutout.png"
  },
  "p-db9dc722b0": {
    "sourceUrl": "https://cdn.shopify.com/s/files/1/0693/8794/3970/products/metallic-silver-cowgirl-boots-201533.jpg?v=1710262433",
    "reviewedCutout": "public/products/p-db9dc722b0-cutout.png"
  },
  "p-fdcac24cb5": {
    "sourceUrl": "https://cdn.shopify.com/s/files/1/0940/5210/files/ponsiesembroideredcowboyboots-SH3950_Silver_1.jpg?v=1780919714",
    "reviewedCutout": "public/products/p-fdcac24cb5-cutout.png"
  },
  "p-bc746b747a": {
    "sourceUrl": "https://cdn.shopify.com/s/files/1/0940/5210/files/western-fringe-boots_1.png?v=1788425397",
    "reviewedCutout": "public/products/p-bc746b747a-cutout.png"
  },
  "p-0a49fa4bf2": {
    "sourceUrl": "https://cdn.shopify.com/s/files/1/0595/2490/7173/files/Caribbean_Blue_Wild_Rag.png?v=1781368858",
    "reviewedCutout": "public/products/p-0a49fa4bf2-cutout.png"
  },
  "p-dd6cb1a575": {
    "sourceUrl": "https://standardandstrange.com/cdn/shop/files/omotodenim-RevealKojimaBandanna-Blue-Flat-07.jpg?v=1785450722&width=1920",
    "reviewedCutout": "public/products/p-dd6cb1a575-cutout.png"
  },
  "p-bbebd49e6b": {
    "sourceUrl": "https://cdn.shopify.com/s/files/1/0254/0447/3422/products/W49440-RWPMKR-634020-PEACEMAKER.jpg?v=1621736000",
    "reviewedCutout": "public/products/p-bbebd49e6b-cutout.png"
  },
  "p-8df245a09b": {
    "sourceUrl": "https://cdn.shopify.com/s/files/1/0254/0447/3422/files/71mjwKTwMmL._AC_UX569.jpg?v=1687447576",
    "reviewedCutout": "public/products/p-8df245a09b-cutout.png"
  },
  "p-bc8f5c1ddb": {
    "sourceUrl": "https://cdn.shopify.com/s/files/1/0940/5210/products/BlackSuedeJacket_Front.jpg?v=1737969048",
    "reviewedCutout": "public/products/p-bc8f5c1ddb-cutout.png"
  }
};

export const photoPlans: Record<string, PhotoPlan> = { ...cowboyPhotos, ...vampirePhotos, ...ghostPhotos, ...mothPhotos, ...mushroomPhotos };
