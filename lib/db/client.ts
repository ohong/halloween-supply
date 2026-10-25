import { createClient, type Client } from "@libsql/client/web";

let client: Client | undefined;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
}

/** HTTP only: no persistent filesystem or database socket is needed on Vercel. */
export function getDatabase(): Client {
  if (!client) {
    if (!isDatabaseConfigured()) throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required.");
    client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
      fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, {
        ...init,
        cache: "no-store",
        signal: init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(5000)])
          : AbortSignal.timeout(5000),
      }),
    });
  }
  return client;
}
