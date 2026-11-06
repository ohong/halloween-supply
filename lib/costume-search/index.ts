import { costumes } from "@/lib/costumes";

export type CatalogSlug = typeof costumes[number]["slug"];
export type SearchMatch = { slug: CatalogSlug; relevance: "strong" | "related" };
export type SearchResponse = {
  query: string;
  matches: SearchMatch[];
  hasStrongMatch: boolean;
  source: "semantic" | "local";
};

export function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/gu, " ");
}

type Concepts = { aliases: string[]; themes: string[]; related?: string[] };

// These describe the actual editorial looks. They are not claims about products,
// stock, sizes, delivery or price, which require the shopping catalog.
const concepts = {
  "velvet-vampire": { aliases: ["vampire", "dracula", "bloodsucker", "nosferatu"], themes: ["gothic", "dark", "elegant", "romantic", "romance", "victorian", "spooky", "black", "burgundy", "velvet", "cape"], related: ["bat", "batman"] },
  "cosmic-cowboy": { aliases: ["cowboy", "cowgirl", "western", "rodeo", "space cowboy"], themes: ["space", "silver", "metallic", "fringe", "futuristic", "music", "festival", "sparkly", "glitter", "disco"] },
  "moon-moth": { aliases: ["moth", "luna moth", "moon moth"], themes: ["insect", "bug", "wings", "winged", "sage", "green", "cream", "soft", "ethereal", "nature", "woodland"], related: ["butterfly", "fairy"] },
  "linen-ghost": { aliases: ["ghost", "sheet ghost", "specter", "spectre", "phantom"], themes: ["spooky", "haunted", "white", "linen", "sheet", "simple", "minimal", "classic", "easy"] },
  "woodland-mushroom": { aliases: ["mushroom", "toadstool", "fungus", "fungi"], themes: ["woodland", "forest", "cottagecore", "nature", "red", "cream", "brown", "corduroy", "overalls", "cute", "whimsical"] },
  "starlight-witch": { aliases: ["witch", "enchantress", "wiccan"], themes: ["magic", "magical", "stars", "starry", "moon", "celestial", "navy", "dark", "velvet", "gothic", "cape"] },
  "clockwork-aviator": { aliases: ["aviator", "pilot", "steampunk", "flight", "airplane"], themes: ["adventurer", "adventure", "goggles", "leather", "brown", "brass", "vintage", "utility", "warm", "jacket"] },
  "autumn-scarecrow": { aliases: ["scarecrow", "farmer", "farmhand"], themes: ["farm", "harvest", "autumn", "fall", "rustic", "plaid", "patchwork", "denim", "overalls", "straw", "brown"] },
  "midnight-pirate": { aliases: ["pirate", "buccaneer", "swashbuckler", "privateer"], themes: ["captain", "sea", "adventure", "black", "burgundy", "brocade", "tricorn", "coat", "historic"], related: ["jack sparrow"] },
  "enchanted-jester": { aliases: ["jester", "court fool", "clown", "harlequin"], themes: ["circus", "carnival", "theatrical", "playful", "diamonds", "plum", "sage", "velvet", "ruff"] },
  "forest-sprite": { aliases: ["sprite", "fairy", "faerie", "elf", "elven", "wood elf"], themes: ["forest", "woodland", "nature", "leaves", "leafy", "moss", "green", "ethereal", "cottagecore", "fantasy", "whimsical"] },
  "celestial-sorcerer": { aliases: ["sorcerer", "wizard", "mage", "magician", "merlin"], themes: ["magic", "magical", "fantasy", "celestial", "stars", "starry", "constellations", "moon", "blue", "robe"] },
  "pumpkin-harlequin": { aliases: ["pumpkin", "harlequin", "jester", "clown"], themes: ["autumn", "fall", "orange", "charcoal", "diamonds", "circus", "carnival", "graphic", "ruffled"] },
  "victorian-detective": { aliases: ["detective", "sherlock", "sherlock holmes", "sleuth", "investigator"], themes: ["mystery", "victorian", "historic", "tweed", "brown", "herringbone", "cape", "deerstalker", "vintage"] },
  "storm-chaser": { aliases: ["storm chaser", "rain", "rainy", "weather", "fisherman", "fisherwoman"], themes: ["storm", "lightning", "yellow", "mustard", "navy", "stripes", "raincoat", "rainboots", "practical", "nautical"] },
  "disco-phantom": { aliases: ["disco", "dancer", "dance", "1970s", "70s"], themes: ["silver", "shimmer", "shimmering", "sparkly", "sequins", "glitter", "glam", "glamorous", "party", "music", "festival", "hooded", "ivory", "flares"] },
  "garden-beekeeper": { aliases: ["beekeeper", "apiarist", "apiary", "bee", "bees"], themes: ["honey", "garden", "nature", "insect", "cream", "utility", "veil", "gloves", "cotton"] },
  "coral-mermaid": { aliases: ["mermaid", "merman", "siren"], themes: ["ocean", "sea", "underwater", "aquatic", "scales", "shell", "shells", "teal", "coral", "seafoam", "fantasy", "ethereal"] },
  "snow-owl": { aliases: ["owl", "snowy owl", "snow owl"], themes: ["bird", "wings", "winged", "feather", "feathers", "ivory", "cream", "white", "soft", "winter", "nature"] },
  "velvet-ringmaster": { aliases: ["ringmaster", "ringleader", "showman", "circus master"], themes: ["circus", "carnival", "theatrical", "top hat", "tailcoat", "red", "velvet", "gold", "braid"] },
  "desert-alchemist": { aliases: ["alchemist", "apothecary", "potion maker"], themes: ["desert", "sand", "linen", "terracotta", "earthy", "medieval", "fantasy", "cloak", "hood", "bottles", "potions"] },
  "rose-garden-queen": { aliases: ["queen", "princess", "royalty", "royal"], themes: ["rose", "roses", "garden", "floral", "flower", "flowers", "burgundy", "velvet", "romantic", "romance", "gothic", "crown", "gown"] },
  "retro-astronaut": { aliases: ["astronaut", "cosmonaut", "space explorer", "space traveler", "space traveller", "spaceman", "spacewoman"], themes: ["space", "cosmic", "retro", "sci fi", "science fiction", "futuristic", "helmet", "cream", "orange", "jumpsuit"] },
  "raven-scholar": { aliases: ["raven", "scholar", "crow", "dark academia", "academic"], themes: ["gothic", "dark", "black", "feathers", "bird", "victorian", "ivory", "waistcoat", "skirt", "bookish"], related: ["batman", "wednesday addams"] },
  "candy-corn-sorceress": { aliases: ["candy corn", "sorceress", "witch"], themes: ["candy", "sweet", "autumn", "fall", "orange", "yellow", "ivory", "stripes", "tiered", "cute", "magic"] },
  "jellyfish-bloom": { aliases: ["jellyfish", "sea jelly"], themes: ["ocean", "underwater", "aquatic", "umbrella", "ribbons", "ethereal", "white", "organza", "diy"] },
  "venus-flytrap": { aliases: ["venus flytrap", "flytrap", "carnivorous plant", "man eating plant"], themes: ["plant", "garden", "green", "teeth", "monster", "nature", "diy"] },
  "stained-glass-angel": { aliases: ["stained glass angel", "angel", "stained glass"], themes: ["wings", "winged", "jewel", "colorful", "cathedral", "gold", "fantasy", "diy"] },
  "lava-lamp": { aliases: ["lava lamp", "lava"], themes: ["retro", "1960s", "60s", "psychedelic", "orange", "silver", "graphic", "diy"] },
  "walking-thundercloud": { aliases: ["thundercloud", "raincloud", "rain cloud", "cloud"], themes: ["weather", "storm", "rain", "umbrella", "grey", "gray", "lightning", "diy"] },
  "art-deco-robot": { aliases: ["robot", "automaton", "android", "art deco robot"], themes: ["metallic", "silver", "machine", "sci fi", "science fiction", "futuristic", "retro"] },
  "haunted-prom-queen": { aliases: ["prom queen", "haunted prom queen", "undead prom queen"], themes: ["prom", "haunted", "spooky", "gown", "crown", "sash", "pageant"] },
  "headless-horseman": { aliases: ["headless horseman", "headless", "sleepy hollow"], themes: ["illusion", "gothic", "spooky", "haunted", "cape", "historic"] },
  "phantom-opera": { aliases: ["phantom of the opera", "opera phantom", "opera"], themes: ["mask", "theater", "theatre", "musical", "gothic", "romantic", "black", "white"] },
  "silent-film-star": { aliases: ["silent film star", "silent movie", "silent film", "movie star"], themes: ["monochrome", "black and white", "cinema", "1920s", "20s", "vintage", "theatrical"] },
  "roller-disco": { aliases: ["roller disco", "roller girl", "roller boy"], themes: ["rainbow", "stripes", "disco", "1970s", "70s", "sporty", "dance", "music", "colorful"] },
  "pop-art-comic": { aliases: ["pop art", "comic book", "comic", "comic strip"], themes: ["graphic", "dots", "colorful", "red", "blue", "yellow", "cartoon", "makeup"] },
  "mad-tea-hatter": { aliases: ["mad hatter", "hatter", "tea party"], themes: ["wonderland", "tea", "top hat", "whimsical", "mismatched", "fantasy"] },
  "queen-of-hearts": { aliases: ["queen of hearts", "red queen", "playing card"], themes: ["wonderland", "cards", "hearts", "red", "black", "royal", "crown"] },
  "candy-automaton": { aliases: ["candy automaton", "wind up doll", "windup doll", "candy robot"], themes: ["candy", "sweet", "stripes", "red", "white", "silver", "toy", "diy"] },
  "deep-sea-diver": { aliases: ["deep sea diver", "diver", "diving"], themes: ["ocean", "sea", "underwater", "nautical", "helmet", "vintage", "adventure"] },
  "dragon-rider": { aliases: ["dragon rider", "dragon", "dragon tamer"], themes: ["fantasy", "medieval", "adventure", "leather", "armor", "armour", "scales"] },
  "phoenix-rising": { aliases: ["phoenix", "firebird", "fire bird"], themes: ["fire", "orange", "red", "gold", "wings", "winged", "bird", "fantasy"] },
  "ice-empress": { aliases: ["ice empress", "ice queen", "snow queen", "winter queen"], themes: ["winter", "frost", "ice", "blue", "silver", "crown", "royal", "fantasy"] },
  "labyrinth-faun": { aliases: ["faun", "satyr", "woodland faun"], themes: ["forest", "woodland", "horns", "mythology", "mythical", "fantasy", "brown", "nature"] },
  "escaped-masterpiece": { aliases: ["escaped masterpiece", "walking painting", "portrait", "painting", "masterpiece"], themes: ["art", "museum", "frame", "gold", "renaissance", "diy"] },
  "fortune-teller": { aliases: ["fortune teller", "soothsayer", "oracle", "seer"], themes: ["mystic", "tarot", "cards", "velvet", "jewel", "gold", "magic"] },
  "alien-botanist": { aliases: ["alien botanist", "alien", "botanist", "extraterrestrial"], themes: ["space", "plant", "garden", "science", "green", "sci fi", "science fiction"] },
  "haunted-bellhop": { aliases: ["bellhop", "haunted bellhop", "hotel porter", "hotel attendant"], themes: ["hotel", "haunted", "spooky", "uniform", "vintage", "red", "gold"] },
  "masquerade-sun-king": { aliases: ["sun king", "sun queen", "sun", "solar monarch"], themes: ["masquerade", "gold", "baroque", "royal", "crown", "mask", "celestial"] },
} satisfies Record<CatalogSlug, Concepts>;

const stopWords = new Set("a an and are as at be been being can costume costumes could do for from halloween have i id im in into is it its like look looking looks me my of on one or outfit outfits please should show some something that the them this to want wear wearing what with would you your male female man men woman women model models cool".split(" "));

function searchable(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function word(value: string) {
  return value.length > 3 && value.endsWith("s") && !value.endsWith("ss") ? value.slice(0, -1) : value;
}

function words(value: string) {
  return searchable(value).split(" ").filter((value) => value.length > 1 && !stopWords.has(value)).map(word);
}

const index = costumes.map((costume) => {
  const entry: Concepts = concepts[costume.slug];
  return {
    slug: costume.slug,
    name: searchable(costume.name),
    aliases: entry.aliases.map(searchable),
    identity: new Set(words([costume.name, ...entry.aliases].join(" "))),
    themes: new Set(words(entry.themes.join(" "))),
    related: new Set(words(entry.related?.join(" ") ?? "")),
    text: new Set(words([costume.description, costume.alt, ...costume.pieces].join(" "))),
  };
});

/** Immediate matching is deliberately separate from provider-confirmed semantics. */
export function localSearch(input: string): SearchResponse {
  const query = normalizeSearchQuery(input);
  if (query.length < 2) return { query, matches: costumes.map(({ slug }) => ({ slug, relevance: "strong" })), hasStrongMatch: true, source: "local" };
  const normalized = searchable(query);
  const tokens = [...new Set(words(query))];
  if (!tokens.length) return { query, matches: [], hasStrongMatch: false, source: "local" };
  const ranked = index.map((entry) => {
    let score = 0;
    let matched = 0;
    let substantive = 0;
    let relatedOnly = false;
    for (const token of tokens) {
      const prefix = token.length >= 2 && [...entry.identity].some((identity) => identity.startsWith(token));
      const themePrefix = token.length >= 3 && [...entry.themes].some((theme) => theme.startsWith(token));
      const weight = entry.identity.has(token) ? 7 : entry.themes.has(token) ? 4 : prefix ? 3 : entry.related.has(token) || themePrefix ? 2 : entry.text.has(token) ? 1 : 0;
      if (weight) { matched++; score += weight; }
      if (weight >= 4) substantive++;
      if (entry.related.has(token) && !entry.identity.has(token)) relatedOnly = true;
    }
    const exact = normalized === entry.name || entry.aliases.includes(normalized);
    if (exact) score += 20;
    const strong = exact || !relatedOnly && matched / tokens.length >= 0.67 && substantive / tokens.length >= 0.67;
    return { slug: entry.slug, score, relevance: strong ? "strong" as const : "related" as const };
  }).filter(({ score }) => score > 0).sort((a, b) => Number(b.relevance === "strong") - Number(a.relevance === "strong") || b.score - a.score);
  const best = ranked[0]?.score ?? 0;
  const matches = ranked.filter(({ score }) => score >= Math.max(2, best * 0.3)).slice(0, 12).map(({ slug, relevance }) => ({ slug, relevance }));
  return { query, matches, hasStrongMatch: matches.some(({ relevance }) => relevance === "strong"), source: "local" };
}
