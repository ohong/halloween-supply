import { PostHog } from "posthog-node";

// Server-side error reporting to PostHog. Both variables must be set: the project token and the ingestion host
// (the region is a deliberate choice, so there is no default host). With either missing this is a no-op.
// The client side is configured in instrumentation-client.ts with the same two variables.
let client: PostHog | null | undefined;

function getClient(): PostHog | null {
  if (client !== undefined) return client;
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  for (const [name, value] of [["NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", token], ["NEXT_PUBLIC_POSTHOG_HOST", host]]) {
    if (!value && process.env.NODE_ENV === "development") {
      console.error(`${name} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${name} is configured`);
    }
  }
  // flushAt 1 plus captureExceptionImmediate: a Vercel function can freeze right after it responds, so queued events would be lost.
  client = token && host ? new PostHog(token, { host, flushAt: 1, flushInterval: 0, requestTimeout: 3000, fetchRetryCount: 0 }) : null;
  return client;
}

/** Reports an error to PostHog and waits for the send. Only called on failure paths. Never throws. */
export async function captureError(error: unknown, context: Record<string, string | number | boolean> = {}): Promise<void> {
  try {
    await getClient()?.captureExceptionImmediate(error, undefined, context);
  } catch {
    // Error reporting must never break the request it is reporting on.
  }
}
