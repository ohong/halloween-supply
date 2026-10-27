/** Shared matching helpers for the eval scripts: garment head nouns, garment classes
 *  and color words, all driven by eval/synonyms.json. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const synonyms = JSON.parse(readFileSync(join(import.meta.dir, "..", "eval", "synonyms.json"), "utf8")) as {
  slot_groups: Record<string, string[]>;
  color_families: Record<string, string[]>;
  garment_classes: Record<string, string[]>;
  class_compat: Record<string, string[]>;
};

export const COLOR_WORDS = [...new Set(Object.values(synonyms.color_families).flat())].sort((a, b) => b.length - a.length);
export const tokens = (s: string) => s.toLowerCase().replace(/[^a-z\s-]/g, " ").split(/[\s-]+/).filter(Boolean);
const singular = (t: string) => t.length > 3 && t.endsWith("s") && !t.endsWith("ss") && !["trousers", "pants", "jeans", "leggings", "shorts", "tights", "stockings", "overalls", "shortalls", "breeches", "culottes", "gloves", "boots", "shoes", "brogues", "wings", "antennae", "sunglasses", "goggles", "bracers", "sneakers", "heels", "loafers", "sandals", "slippers", "oxfords", "pumps", "flats", "wellies"].includes(t) ? t.slice(0, -1) : t;

/** The garment keyword nearest the end of the phrase, i.e. its head noun. A trailing
 *  "with ..." clause describes a detail ("cape with pale collar"), so it is ignored. */
export function headNoun(phrase: string): string | null {
  const ts = tokens(phrase.split(/\s+with\s+/i)[0]).map(singular);
  const all = new Set(Object.values(synonyms.garment_classes).flat().map(singular));
  for (let i = ts.length - 1; i >= 0; i--) if (all.has(ts[i])) return ts[i];
  return null;
}
export function classesOf(noun: string | null): string[] {
  if (!noun) return [];
  return Object.entries(synonyms.garment_classes).filter(([, ws]) => ws.map(singular).includes(noun)).map(([c]) => c);
}
export function garmentSimilarity(pred: string, gt: string): number {
  const a = headNoun(pred), b = headNoun(gt);
  if (a && b && a === b) return 1;
  const ca = classesOf(a), cb = classesOf(b);
  if (ca.some(c => cb.includes(c))) return 0.75;
  if (ca.some(c => (synonyms.class_compat[c] ?? []).some(x => cb.includes(x)))) return 0.5;
  const ta = new Set(tokens(pred)), tb = new Set(tokens(gt));
  const inter = [...ta].filter(t => tb.has(t) && !COLOR_WORDS.includes(t)).length;
  return inter / Math.max(1, new Set([...ta, ...tb]).size);
}
/** The first color word in the text; luna's query leads with the piece's main color. */
export function colorFrom(text: string): string | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z]+/g, " ")} `;
  let best: { word: string; at: number } | null = null;
  for (const word of COLOR_WORDS) {
    const at = t.indexOf(` ${word} `);
    if (at >= 0 && (!best || at < best.at)) best = { word, at };
  }
  return best?.word ?? null;
}

/** The color family a color word belongs to ("charcoal" -> "black"), or the word itself. */
export function colorFamily(word: string | null): string | null {
  if (!word) return null;
  const w = word.toLowerCase();
  return Object.entries(synonyms.color_families).find(([, ws]) => ws.includes(w))?.[0] ?? w;
}
