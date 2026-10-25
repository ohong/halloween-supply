import "server-only";

/** Server-only rehearsal policy for session timers and simultaneous photo work. */
export function isTryOnTesting() {
  return process.env.TRY_ON_TESTING_MODE === "1";
}

export function mirrorSessionSeconds(): number | null {
  return isTryOnTesting() ? null : 180;
}
