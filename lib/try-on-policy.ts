import "server-only";

/** Temporary demo policy. Restoring quotas also requires enabling the WAF rules. */
export function isTryOnTesting() {
  return process.env.TRY_ON_TESTING_MODE === "1";
}

export function mirrorSessionSeconds(): number | null {
  return isTryOnTesting() ? null : 180;
}
