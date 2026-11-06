import { z } from "zod";
import { PreviewError } from "../ai/openai";
export const savedLookHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export const savedLookReply = (status: number, body: object) => Response.json(body, { status, headers: savedLookHeaders });
export async function savedLookBody<T>(request: Request, schema: z.ZodType<T>, limit = 40_000): Promise<T> {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new PreviewError(403, "Open saved looks from this site.");
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new PreviewError(400, "Send the look as JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new PreviewError(400, "The saved look is missing.");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.length;
    if (length > limit) { await reader.cancel(); throw new PreviewError(413, "This look is too large to save."); }
    chunks.push(value);
  }
  return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
export function savedLookFailure(error: unknown) {
  if (error instanceof PreviewError) return savedLookReply(error.status, { error: error.message });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return savedLookReply(400, { error: "This look is invalid. Source the affected pieces again." });
  console.warn("[saved-look] Request failed", error instanceof Error ? error.name : "UnknownError");
  return savedLookReply(503, { error: "The look could not be saved. Please try again later." });
}
