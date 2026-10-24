// Merchant hints scraped from a product page, fed to the ranker. Pure and dependency-free.
import { htmlToText, readProductJsonLdNodes, decodeEntities } from "./parse";

export interface MerchantHints {
  siteName: string | null;
  /** brand / seller name from JSON-LD (on Etsy this is the shop name). */
  brand: string | null;
  /** Short text snippets that mention location, shipping origin or a storefront. */
  locationSnippets: string[];
  /** Bay Area place names found on the page, e.g. ["Oakland", "San Francisco"]. */
  bayAreaMentions: string[];
}

export const BAY_AREA_CITIES = [
  "San Francisco", "Oakland", "Berkeley", "Alameda", "Emeryville", "San Jose", "Palo Alto", "Mountain View",
  "Sunnyvale", "Santa Clara", "Redwood City", "San Mateo", "Daly City", "South San Francisco", "Walnut Creek",
  "Fremont", "Hayward", "San Rafael", "Sausalito", "Mill Valley", "Petaluma", "Santa Rosa", "Napa", "Vallejo",
  "Los Gatos", "Menlo Park", "Burlingame", "Pacifica", "Half Moon Bay", "Albany", "El Cerrito", "San Leandro",
  "Livermore", "Pleasanton", "Novato", "Larkspur", "Sebastopol", "Healdsburg", "Sonoma", "Richmond", "Cupertino",
];

const nameOf = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (Array.isArray(v)) return nameOf(v[0]);
  if (v && typeof v === "object") return nameOf((v as Record<string, unknown>).name);
  return null;
};

export function extractMerchantHints(html: string, _url: string): MerchantHints {
  void _url;
  const siteName = (() => {
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
      if (/property\s*=\s*["']og:site_name["']/i.test(tag)) {
        const c = tag.match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i);
        const v = c?.[1] ?? c?.[2];
        if (v) return decodeEntities(v).trim();
      }
    }
    return null;
  })();

  let brand: string | null = null;
  try {
    for (const n of readProductJsonLdNodes(html)) {
      brand = nameOf(n.brand) ?? nameOf(n.seller) ?? nameOf((n.offers as { seller?: unknown } | undefined)?.seller) ?? null;
      if (brand) break;
    }
  } catch {
    brand = null;
  }

  const text = htmlToText(html);
  const snippets: string[] = [];
  const re = /(ships from|shop location|located in|based in|visit us|our (?:store|shop)|store hours|local pick ?up)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && snippets.length < 4) {
    const s = text.slice(Math.max(0, m.index - 60), m.index + 100).trim();
    if (!snippets.some((x) => x.slice(20, 60) === s.slice(20, 60))) snippets.push(s);
  }

  const mentions: string[] = [];
  for (const city of BAY_AREA_CITIES) {
    const withState = new RegExp(`\\b${city}\\b,?\\s*(?:CA\\b|California)`, "i");
    if (withState.test(text)) mentions.push(city);
  }
  if (/\bbay area\b/i.test(text)) mentions.push("Bay Area");

  return { siteName, brand, locationSnippets: snippets, bayAreaMentions: mentions };
}
