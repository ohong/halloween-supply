// Merchant size and location do not restrict sourcing. Short links are not canonical product pages.
export const BLOCKED_DOMAINS: readonly string[] = ["amzn.to", "a.co"];

// Sites that are never product pages (social, video, wikis, search engines).
export const NOISE_DOMAINS = [
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

/** Reject noncanonical short-link hosts and unparseable inputs. */
export function isBlockedDomain(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return true;
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
