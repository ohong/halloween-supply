import { z } from "zod";
import { normalizeSearchQuery } from "@/lib/costume-search";
import { semanticSearch } from "@/lib/costume-search/server";

export const maxDuration = 20;

const MAX_BODY_BYTES = 2048;
const BODY_TOO_LARGE = Symbol("body-too-large");
const requestSchema = z.object({ query: z.string().max(640).transform(normalizeSearchQuery).pipe(z.string().max(160)) }).strict();
const respond = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });

async function readBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return BODY_TOO_LARGE;
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) { await reader.cancel(); return BODY_TOO_LARGE; }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (request.headers.get("sec-fetch-site") === "cross-site") return respond({ error: "Search from this site." }, 403);
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.host !== host || parsed.origin !== origin) return respond({ error: "Search from this site." }, 403);
    } catch { return respond({ error: "Search from this site." }, 403); }
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return respond({ error: "Send the search as JSON." }, 415);
  try {
    const raw = await readBody(request);
    if (raw === BODY_TOO_LARGE) return respond({ error: "The search request is too large." }, 413);
    const { query } = requestSchema.parse(raw);
    return respond(await semanticSearch(query));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return respond({ error: "Enter a search of at most 160 characters." }, 400);
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return respond({ error: "Search could not finish. Please try again." }, 502);
  }
}
