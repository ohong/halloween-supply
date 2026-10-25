import "server-only";

/** Demo size assumptions must never reach a live-money checkout. */
export function usesDemoSizes(): boolean {
  return process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ?? false;
}
