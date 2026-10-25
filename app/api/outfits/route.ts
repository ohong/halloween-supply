import { createHash } from "node:crypto";
import { z } from "zod";
import { getCostume } from "@/lib/catalog";
import { outfitRequestSchema, StylistError } from "@/lib/stylist/contracts";
import { styleOutfit } from "@/lib/stylist/decide";

export const maxDuration = 300;
const MAX_BODY = 16_000;
// A local cost guard, not a deployment-wide quota. No request text is retained.
const attempts = new Map<string, { count: number; expires: number }>();
let active = 0;

function reserve(request: Request) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key);
  const address = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const id = createHash("sha256").update(address).digest("hex");
  const entry = attempts.get(id) ?? { count: 0, expires: now + 3_600_000 };
  if (entry.count >= 12) throw new StylistError(429, "You have reached twelve styling requests this hour. Please try again later.", "busy");
  if (active >= 4 || attempts.size >= 2000) throw new StylistError(429, "The personal stylist is busy. Please try again shortly.", "busy");
  attempts.set(id, { ...entry, count: entry.count + 1 });
  active++;
}

async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new StylistError(400, "Send the styling request as JSON.", "invalid_request");
  if (Number(request.headers.get("content-length")) > MAX_BODY) throw new StylistError(413, "The styling request is too large.", "invalid_request");
  const reader = request.body?.getReader();
  if (!reader) throw new StylistError(400, "The styling request is missing.", "invalid_request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new StylistError(413, "The styling request is too large.", "invalid_request"); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function POST(request: Request) {
  let reserved = false;
  const respond = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new StylistError(403, "Start the personal stylist from this site.", "invalid_request");
    const body = outfitRequestSchema.parse(await readBody(request));
    const costume = await getCostume(body.costumeSlug);
    if (!costume) throw new StylistError(404, "That costume is not in the catalog.", "invalid_request");
    reserve(request); reserved = true;
    const result = await styleOutfit(costume, body, request.signal);
    return respond(200, result);
  } catch (error) {
    if (error instanceof StylistError) return respond(error.status, { error: error.message, code: error.code, ...error.details });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return respond(400, { error: "Choose a valid costume, dollar budget, sizes, and preferences.", code: "invalid_request" });
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return respond(504, { error: "The personal stylist took too long. Please try again later.", code: "provider_unavailable" });
    console.warn("[stylist] Outfit comparison failed", error instanceof Error ? error.name : "UnknownError");
    return respond(502, { error: "The personal stylist could not finish. Please try again later.", code: "provider_unavailable" });
  } finally { if (reserved) active--; }
}
