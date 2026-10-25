import { z } from "zod";
import { getCostume } from "@/lib/catalog";
import { outfitRequestSchema, StylistError } from "@/lib/stylist/contracts";
import { styleOutfit } from "@/lib/stylist/decide";

export const maxDuration = 300;
const MAX_BODY = 16_000;
// Bound simultaneous provider work without limiting repeated demo attempts.
let active = 0;

function reserve() {
  if (active >= 4) throw new StylistError(429, "The personal stylist is busy. Please try again shortly.", "busy");
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
    reserve(); reserved = true;
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
