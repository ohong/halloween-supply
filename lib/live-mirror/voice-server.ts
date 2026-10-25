import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getCostume } from "@/lib/catalog";
import type { CostumeView } from "@/lib/types";
import type { MirrorOutfit } from "./types";
import { MIRROR_SESSION_STARTS_PER_HOUR } from "./session-limits";
import { isTryOnTesting } from "@/lib/try-on-policy";

export class VoiceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const id = z.string().min(1).max(150);
export const outfitSchema = z.object({
  selection: z.record(id, id), uses: z.record(id, z.enum(["buy", "owned", "skip"])),
  locked: z.array(id).max(20), budget: z.string().max(20).refine(value => !value.trim() || (/^\d+(\.\d{1,2})?$/.test(value) && Number(value) <= 1000000)),
}).strict();
const catalogContextSchema = z.object({
  query: z.string().max(2000),
  matches: z.array(z.object({ costumeSlug: id, pieceId: id, productId: id }).strict()).max(8),
}).strict();
export const requestBase = z.object({ costumeSlug: id, outfit: outfitSchema, catalogContext: catalogContextSchema.optional() });
const rates = new Map<string, { count: number; expires: number }>();
export function voiceResponse(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
export function voiceFailure(error: unknown) {
  if (error instanceof VoiceError) return voiceResponse({ error: error.message }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return voiceResponse({ error: "The request is invalid. Refresh the page and try again." }, 400);
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return voiceResponse({ error: "The connection took too long. Please try again." }, 504);
  console.warn("[live-mirror] Voice request failed", error instanceof Error ? error.name : "UnknownError");
  return voiceResponse({ error: "The voice service could not respond. Please try again." }, 502);
}
export function voiceRequestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  try {
    const parsed = new URL(origin ?? "");
    // Next may expose an internal bind address in Request.url. Use the actual
    // request Host, never an untrusted forwarded host, for browser-origin checks.
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.host !== host || parsed.origin !== origin) throw new Error("Different origin");
    return parsed.origin;
  } catch { throw new VoiceError(403, "Open the mirror from this site."); }
}
export async function readVoiceRequest(request: Request, kind: "session" | "command") {
  voiceRequestOrigin(request);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new VoiceError(415, "Send a JSON request.");
  if (!process.env.OPENAI_API_KEY) throw new VoiceError(503, "Voice styling is not available yet. You can still choose pieces below.");
  if (!isTryOnTesting()) {
    const now = Date.now();
    for (const [key, item] of rates) if (item.expires <= now) rates.delete(key);
    const address = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
    const key = createHash("sha256").update(`${kind}:${address}`).digest("hex");
    const record = rates.get(key) ?? { count: 0, expires: now + 3600000 };
    if (record.count >= (kind === "session" ? MIRROR_SESSION_STARTS_PER_HOUR : 120) || rates.size >= 2000) throw new VoiceError(429, "The styling room has reached its hourly request limit. Please try again later.");
    rates.set(key, { ...record, count: record.count + 1 });
  }
  const reader = request.body?.getReader();
  if (!reader) throw new VoiceError(400, "The request is empty.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 65536) { await reader.cancel(); throw new VoiceError(413, "The request is too large."); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
export async function validatedCostume(slug: string, outfit: MirrorOutfit, inventory?: CostumeView[]) {
  const costume = inventory ? inventory.find(view => view.costume.slug === slug) : await getCostume(slug);
  if (!costume) throw new VoiceError(400, "Choose a costume from the gallery.");
  const ids = new Set(costume.pieces.map(({ piece }) => piece.id));
  if ([...Object.keys(outfit.selection), ...Object.keys(outfit.uses), ...outfit.locked].some(key => !ids.has(key))) throw new VoiceError(400, "An outfit piece is no longer available.");
  for (const { piece, options } of costume.pieces) {
    if (!options.some(({ product }) => product.id === outfit.selection[piece.id])) throw new VoiceError(400, "Select a valid product for each piece.");
    if (piece.required && outfit.uses[piece.id] === "skip") throw new VoiceError(400, "Required pieces cannot be skipped.");
  }
  return costume;
}
export async function voiceOpenAI(endpoint: "live/sessions" | "decisions" | "responses", body: object, signal: AbortSignal) {
  const result = await fetch(`https://api.openai.com/v1/${endpoint}`, {
    method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), cache: "no-store",
  });
  if (!result.ok) {
    console.warn(`[live-mirror] OpenAI ${endpoint} returned ${result.status}`);
    if ([401, 403, 404].includes(result.status)) throw new VoiceError(503, "Voice styling is temporarily unavailable. Please choose pieces manually.");
    if (result.status === 429) throw new VoiceError(429, "Voice styling is busy. Please try again shortly.");
    throw new VoiceError(502, "Voice styling could not connect. Please try again.");
  }
  return result.json() as Promise<unknown>;
}
