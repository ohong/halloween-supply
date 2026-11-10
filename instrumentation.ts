import type { Instrumentation } from "next";

export async function register() {
  // Node runtime only; production only. A missing variable must not throw here: that would take down every
  // page, including the ones that do not need it. Log the names loudly and report them instead.
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { missingEnv } = await import("./lib/env");
  const missing = missingEnv();
  if (missing.length === 0) return;
  console.error(`[env] Missing required production environment variables: ${missing.join(", ")}`);
  const { captureError } = await import("./lib/errors");
  await captureError(new Error(`Missing required production environment variables: ${missing.join(", ")}`), { source: "env" });
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureError } = await import("./lib/errors");
  // Path without the query string, which can carry shopper input.
  await captureError(error, { source: "request", method: request.method, path: request.path.split("?")[0], route: context.routePath, routeType: context.routeType });
};
