import { isIP } from "node:net";
import { isBlockedDomain, isNoiseDomain } from "../sourcing/blocklist";

/** Sourced records use public HTTPS names. Preview never fetches these URLs. */
export function isPublicProductUrl(value: string, product = false) {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || url.port || isIP(host) ||
      !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|home|lan)$/.test(host)) return false;
    return !product || (!isBlockedDomain(value) && !isNoiseDomain(value));
  } catch { return false; }
}
