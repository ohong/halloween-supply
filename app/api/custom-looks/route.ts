import { createHash } from "node:crypto";
import { z } from "zod";
import { isDatabaseConfigured } from "@/lib/db/client";
import { planCustomLook } from "@/lib/custom-looks/plan";
import { sourcePiece, toCartItem } from "@/lib/custom-looks/source";
import { claimCustomLook, readCustomLookRequest, saveCustomLook } from "@/lib/custom-looks/store";
import { validateCustomItem } from "@/lib/custom-looks/validate";
import type { CustomLook, CustomLookEvent } from "@/lib/custom-looks/types";

export const maxDuration = 180;

const MAX_BODY = 3000;
const bodySchema = z.object({
  query: z.string().transform((value) => value.trim().replace(/\s+/g, " ")).pipe(z.string().min(3).max(160)),
  model: z.enum(["male", "female"]),
  requestId: z.uuid().transform((value) => value.toLowerCase()),
}).strict();
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const reply = (status: number, body: object) => Response.json(body, { status, headers });
const attempts = new Map<string, { count: number; expires: number }>();
let active = 0;

class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// This bounds one process. The durable request claim prevents duplicate work across processes.
function reserve(request: Request) {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.expires <= now) attempts.delete(key);
  const address = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const key = createHash("sha256").update(address).digest("hex");
  const entry = attempts.get(key) ?? { count: 0, expires: now + 3_600_000 };
  if (entry.count >= 8) throw new RequestError(429, "You have created eight looks this hour. Please try again later.");
  if (active >= 3 || attempts.size >= 2000) throw new RequestError(429, "Costume creation is busy. Please try again shortly.");
  attempts.set(key, { ...entry, count: entry.count + 1 });
  active++;
}

async function readBody(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new RequestError(400, "Send the costume idea as JSON.");
  if (Number(request.headers.get("content-length")) > MAX_BODY) throw new RequestError(413, "The costume idea is too long.");
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "Enter a costume idea.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new RequestError(413, "The costume idea is too long."); }
    chunks.push(value);
  }
  return bodySchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

function doneEvent(look: CustomLook): CustomLookEvent {
  const found = look.pieces.filter(({ item }) => item !== null).length;
  return { t: "done", id: look.id, href: `/create/${look.id}`, found, missing: look.pieces.length - found };
}

function replay(look: CustomLook) {
  const events: CustomLookEvent[] = [
    { t: "look", name: look.name, summary: look.summary, pieces: look.pieces.map(({ piece }) => piece) },
    ...look.pieces.map(({ item }, i): CustomLookEvent => item ? { t: "piece", i, item } : { t: "miss", i }),
    doneEvent(look),
  ];
  return new Response(events.map((event) => JSON.stringify(event)).join("\n") + "\n", {
    headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}

function duplicate(look: CustomLook, body: z.infer<typeof bodySchema>) {
  if (look.query !== body.query || look.model !== body.model) return reply(409, { error: "This request belongs to a different costume idea. Start a new attempt." });
  if (look.state === "complete" || look.state === "partial") return replay(look);
  if (look.state === "running") return reply(409, { error: "This costume is still being created. Retry shortly to reopen the same look.", id: look.id });
  return reply(409, { error: look.error ?? "This creation could not finish. Start a new attempt to retry.", id: look.id, retryWithNewRequestId: true });
}

async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([work, stopped]); }
  finally { signal.removeEventListener("abort", abort); }
}

export async function POST(request: Request) {
  let claimed: CustomLook;
  let reserved = false;
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
      throw new RequestError(403, "Start costume creation from this site.");
    }
    const body = await readBody(request);
    if (!isDatabaseConfigured()) throw new RequestError(503, "Costume creation is unavailable right now. Please try again later.");
    // Reopening saved work needs neither provider availability nor another quota reservation.
    const previous = await readCustomLookRequest(body.requestId);
    if (previous) return duplicate(previous, body);
    if (!process.env.ANTHROPIC_API_KEY || !process.env.FIRECRAWL_API_KEY) {
      throw new RequestError(503, "Costume creation is unavailable right now. Please try again later.");
    }
    reserve(request); reserved = true;
    const result = await claimCustomLook(body);
    if (!result.claimed) {
      active--; reserved = false;
      return duplicate(result.look, body);
    }
    claimed = result.look;
  } catch (error) {
    if (reserved) active--;
    if (error instanceof RequestError) return reply(error.status, { error: error.message });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return reply(400, { error: "Enter a costume idea between 3 and 160 characters and choose a model." });
    console.warn("[custom-look] Request could not start", error instanceof Error ? error.name : "UnknownError");
    return reply(503, { error: "Your costume could not be saved. Please try again later." });
  }

  const encoder = new TextEncoder();
  const cancelled = new AbortController();
  const signal = AbortSignal.any([request.signal, cancelled.signal, AbortSignal.timeout(120_000)]);
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let look = claimed;
      let writes = Promise.resolve();
      const persist = () => {
        const snapshot = structuredClone(look);
        writes = writes.then(() => saveCustomLook(snapshot));
        return writes;
      };
      const emit = (event: CustomLookEvent) => {
        if (!open) return;
        try { controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); }
        catch { open = false; cancelled.abort(); }
      };
      const log = (_kind: string, text: string) => emit({ t: "log", text });
      try {
        emit({ t: "log", text: "Planning the costume…" });
        const plan = await planCustomLook(look.query, look.model, signal);
        look = { ...look, name: plan.name, summary: plan.summary, pieces: plan.pieces.map((piece) => ({ piece, item: null })) };
        await persist();
        emit({ t: "look", ...plan });
        const sourcing = Promise.allSettled(plan.pieces.map(async (piece, i) => {
          const found = await sourcePiece(piece, log, signal, { strictRelevance: true, audience: plan.audience });
          signal.throwIfAborted();
          if (!found) { emit({ t: "miss", i }); return; }
          let item;
          try { item = validateCustomItem(toCartItem(i, piece, found, `custom-${look.id}`)); }
          catch { emit({ t: "miss", i }); return; }
          // A repeated bundle or garment is one charge, never two costume components.
          if (look.pieces.some((row) => row.item?.productId === item.productId)) { emit({ t: "miss", i }); return; }
          look.pieces[i] = { piece, item };
          await persist();
          emit({ t: "piece", i, item });
          emit({ t: "log", text: `${piece.name}: found at ${item.merchantName}.` });
        }));
        const outcomes = await untilAborted(sourcing, signal);
        const rejected = outcomes.find((outcome) => outcome.status === "rejected");
        if (rejected?.status === "rejected") throw rejected.reason;
        signal.throwIfAborted();
        const found = look.pieces.filter(({ item }) => item !== null).length;
        if (!found) throw new RequestError(422, "No verified products were found for this idea. Try a more specific costume description.");
        look = { ...look, state: found === look.pieces.length ? "complete" : "partial" };
        await persist();
        emit(doneEvent(look));
      } catch (error) {
        const message = error instanceof RequestError ? error.message
          : signal.aborted ? "Costume creation stopped before it finished. Start a new attempt to try again."
          : "This costume could not be finished. Start a new attempt to try again.";
        const found = look.pieces.filter(({ item }) => item !== null).length;
        look = { ...look, state: found > 0 && found < look.pieces.length ? "partial" : "failed", error: message };
        let terminalSaved = false;
        try {
          // A rejected progress write must not prevent a final recovery write.
          await writes.catch(() => undefined);
          await saveCustomLook(look);
          terminalSaved = true;
          if (look.state === "partial" && !signal.aborted) { emit(doneEvent(look)); return; }
        } catch { console.warn("[custom-look] Could not save terminal state"); }
        emit({ t: "error", text: message, ...(terminalSaved ? { retryWithNewRequestId: true } : {}) });
      } finally {
        active--;
        if (open) { open = false; controller.close(); }
      }
    },
    cancel() { open = false; cancelled.abort(); },
  });
  return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no" } });
}
