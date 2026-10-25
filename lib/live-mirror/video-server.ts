import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

export const VIDEO_MODEL = "lucy-vton-3.6";
export const VIDEO_SESSION_SECONDS = 180;

export class VideoError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function videoResponse(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

export function videoFailure(error: unknown) {
  if (error instanceof VideoError) return videoResponse({ error: error.message }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return videoResponse({ error: "The mirror request is invalid. Please try again." }, 400);
  console.warn("[live-mirror] Video request failed", error instanceof Error ? error.name : "UnknownError");
  return videoResponse({ error: "The live mirror could not connect. Please try again shortly." }, 502);
}

/** Local protection only; configure deployment-wide quotas before public launch. */
const attempts = new Map<string, { count: number; expires: number }>();
export function reserveVideoRequest(request: Request, kind: "token" | "reference") {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key);
  const address = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${kind}:${createHash("sha256").update(address).digest("hex")}`;
  const entry = attempts.get(key) ?? { count: 0, expires: now + 3_600_000 };
  if (entry.count >= (kind === "token" ? 8 : 180) || attempts.size >= 2000) {
    throw new VideoError(429, "The live mirror has reached its session limit. Please try again later.");
  }
  attempts.set(key, { ...entry, count: entry.count + 1 });
}

export function videoRequestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  try {
    const parsed = new URL(origin ?? "");
    // Next can expose its internal 0.0.0.0 origin behind a dev/reverse proxy.
    // Compare the browser origin to the request Host, never a forwarded host.
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.host !== host || parsed.origin !== origin) throw new Error("Different origin");
    return parsed.origin;
  } catch { throw new VideoError(403, "Open the live mirror from this site."); }
}

export async function readVideoJson(request: Request) {
  videoRequestOrigin(request);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new VideoError(415, "Send a JSON mirror request.");
  const maxBytes = 16_384;
  if (Number(request.headers.get("content-length")) > maxBytes) throw new VideoError(413, "This outfit request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new VideoError(400, "The mirror request is missing.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new VideoError(413, "This outfit request is too large."); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
