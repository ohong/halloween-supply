// Hard-blocked national big-box retailers (brief: "Sourcing rules"). Pure, no imports.

/** Exact registrable domains; subdomains are matched too. */
export const BLOCKED_DOMAINS: readonly string[] = [
  "amazon.com", "amzn.to", "a.co",
  "spirithalloween.com", "spiritchristmas.com",
  "partycity.com", "halloweencity.com",
  "walmart.com", "walmart.ca", "target.com",
  "temu.com", "shein.com", "aliexpress.com", "aliexpress.us", "wish.com",
  "bootbarn.com", "zappos.com", "nordstrom.com", "nordstromrack.com", "macys.com", "kohls.com",
  "asos.com", "urbanoutfitters.com", "revolve.com", "fashionnova.com", "dillards.com",
  "jcpenney.com", "oldnavy.com", "gap.com", "hm.com", "zara.com", "lulus.com", "ebay.com",
  // "and similar" costume and craft big boxes
  "buycostumes.com", "halloweencostumes.com", "costumesupercenter.com", "spencersonline.com",
  "joann.com", "michaels.com", "hobbylobby.com", "kmart.com", "sears.com", "wayfair.com",
];

// Brands with many country domains (amazon.co.uk, ebay.de, ...).
const BLOCKED_BRAND_RE = /(^|\.)(amazon|ebay|aliexpress|temu|shein|walmart)\.(com?\.[a-z]{2}|[a-z]{2,3})$/;

// Sites that are never product pages (social, video, wikis, search engines).
const NOISE_DOMAINS = [
  "google.com", "pinterest.com", "youtube.com", "reddit.com", "facebook.com", "instagram.com",
  "tiktok.com", "wikipedia.org", "x.com", "twitter.com", "quora.com", "medium.com", "bing.com",
];

export function hostnameOf(urlOrHost: string): string | null {
  try {
    const u = urlOrHost.includes("://") ? new URL(urlOrHost) : new URL(`https://${urlOrHost}`);
    return u.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  } catch {
    return null;
  }
}

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** True when the URL's host is a blocked retailer (or a subdomain of one). Unparseable input is blocked. */
export function isBlockedDomain(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return true;
  if (BLOCKED_BRAND_RE.test(host)) return true;
  return BLOCKED_DOMAINS.some((d) => matchesDomain(host, d));
}

/** True for social/video/search hosts that never hold a product page. */
export function isNoiseDomain(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return true;
  return NOISE_DOMAINS.some((d) => matchesDomain(host, d));
}

/** Registrable-ish domain for display and merchant ids (handles common two-part TLDs). */
export function registrableDomain(urlOrHost: string): string | null {
  const host = hostnameOf(urlOrHost);
  if (!host) return null;
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const twoPartTld = /^(co|com|org|net|ac|gov)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2;
  return parts.slice(twoPartTld ? -3 : -2).join(".");
}
