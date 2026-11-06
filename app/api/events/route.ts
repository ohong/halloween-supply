import { MAX_EVENT_BYTES, parseEvent, recordEvent } from "@/lib/telemetry/server";

export const maxDuration = 5;

function response(status: number) {
  return new Response(null, { status, headers: {
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    ...(status === 429 ? { "Retry-After": "60" } : {}),
  } });
}

function sameOrigin(request: Request) {
  try {
    const origin = request.headers.get("origin");
    const parsed = new URL(origin ?? "");
    const host = request.headers.get("host") ?? new URL(request.url).host;
    // Host is the direct request target. Forwarded host headers are not trusted.
    return ["http:", "https:"].includes(parsed.protocol) && parsed.origin === origin && parsed.host === host &&
      request.headers.get("sec-fetch-site") !== "cross-site";
  } catch { return false; }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return response(403);
  if (process.env.TELEMETRY_DISABLED === "1" || request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1") return response(204);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return response(415);
  if (Number(request.headers.get("content-length")) > MAX_EVENT_BYTES) return response(413);
  const reader = request.body?.getReader();
  if (!reader) return response(400);
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_EVENT_BYTES) {
        await reader.cancel();
        return response(413);
      }
      chunks.push(value);
    }
    const event = parseEvent(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!event) return response(400);
    return response(recordEvent(event) === "limited" ? 429 : 204);
  } catch { return response(400); }
}
