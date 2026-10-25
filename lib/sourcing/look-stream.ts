import { PreviewError } from "@/lib/ai/openai";
import { screenshotSourcing, type SourcingLog as Log } from "@/lib/sourcing/screenshot";
import type { ScreenshotLook } from "@/lib/sourcing/screenshot-vision";
import { toCartItem } from "@/lib/custom-looks/source";

export const SEARCH_BUDGET_MS = 30_000;

// Bound simultaneous provider work without limiting repeated demo attempts.
export function createGuard(limit = 4) {
  let active = 0;
  return {
    reserve() {
      if (active >= limit) throw new PreviewError(429, "The stylist is busy. Please try again shortly.");
      active++;
    },
    release() { active--; },
  };
}

export function checkOrigin(request: Request, message: string) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new PreviewError(403, message);
}

/** Reads a multipart body with a hard byte cap, before any provider work starts. */
export async function readForm(request: Request, maxBytes: number, tooBig: string, missing: string) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new PreviewError(400, missing);
  if (Number(request.headers.get("content-length")) > maxBytes) throw new PreviewError(413, tooBig);
  const reader = request.body?.getReader();
  if (!reader) throw new PreviewError(400, missing);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new PreviewError(413, tooBig); }
    chunks.push(value);
  }
  try {
    return await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type")! } }).formData();
  } catch { throw new PreviewError(400, "The upload could not be read. Please choose the file again."); }
}

interface StreamOptions {
  request: Request;
  model: string;
  /** Reference JPEG for sourcing and the product photo review. */
  image: Buffer;
  /** Produces the shopping list. Omit analysisMs to share the search budget with it (still image). */
  analyze: (signal: AbortSignal, log: Log) => Promise<ScreenshotLook>;
  analysisMs?: number;
  timeoutText: string;
  failureText: string;
  readingText: string;
  release: () => void;
}

/** Streams NDJSON look / candidate / piece / miss / done / error events while each piece is shopped. */
export function streamLook({ request, model, image, analyze, analysisMs, timeoutText, failureText, readingText, release }: StreamOptions) {
  const encoder = new TextEncoder();
  const t0 = performance.now();
  let open = true;
  const cancelled = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: Record<string, unknown>) => {
        const line = { ...event, ms: Math.round(performance.now() - t0) };
        if (open) controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
      };
      const log: Log = (kind, text) => emit({ t: "log", kind, text });
      const deadline = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const startDeadline = () => { timer = setTimeout(() => deadline.abort(new DOMException("Search budget reached", "TimeoutError")), SEARCH_BUDGET_MS); };
      if (!analysisMs) startDeadline();
      const signal = AbortSignal.any([request.signal, cancelled.signal, deadline.signal]);
      const matched = new Set<number>();
      const priced = new Set<number>();
      let pieceCount = 0;
      let analysisTimedOut: AbortSignal | undefined;
      try {
        log("think", readingText);
        let look: ScreenshotLook;
        if (analysisMs) {
          analysisTimedOut = AbortSignal.timeout(analysisMs);
          look = await analyze(AbortSignal.any([request.signal, cancelled.signal, analysisTimedOut]), log);
          startDeadline();
        } else look = await analyze(signal, log);
        if (signal.aborted) signal.throwIfAborted();
        pieceCount = look.pieces.length;
        emit({ t: "look", ...look });
        log("look", `Looking for ${look.pieces.map(piece => piece.name.toLowerCase()).join(", ")}`);
        const source = screenshotSourcing(signal, log, image);
        const work = Promise.allSettled(look.pieces.map((piece, i) => source(piece, match => {
          if (signal.aborted) return;
          if (!match) { matched.delete(i); emit({ t: "miss", i }); return; }
          matched.add(i);
          emit({ t: "candidate", i, match });
        }, hit => {
          if (signal.aborted) return;
          priced.add(i);
          matched.add(i);
          const sizedPiece = piece.sizeKind === "one_size" && /harness/i.test(piece.name) && hit.sizes.some(size => !/^one[ -]?size$|^default title$/i.test(size))
            ? { ...piece, sizeKind: "apparel" as const } : piece;
          emit({ t: "piece", i, why: hit.why ?? "Similar style. Colors and details may differ.", item: toCartItem(i, sizedPiece, hit) });
        })));
        await Promise.race([work, new Promise<void>(resolve => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        })]);
        if (!request.signal.aborted && !cancelled.signal.aborted) {
          for (let i = 0; i < pieceCount; i++) if (!matched.has(i)) emit({ t: "miss", i });
          emit({ t: "done", found: matched.size, priced: priced.size, timedOut: deadline.signal.aborted });
        }
      } catch (error) {
        if (!request.signal.aborted && !cancelled.signal.aborted) {
          const text = error instanceof PreviewError ? error.message
            : analysisTimedOut?.aborted || deadline.signal.aborted ? timeoutText
            : failureText;
          emit({ t: "error", text });
        }
      } finally {
        clearTimeout(timer);
        deadline.abort();
        release();
        if (open) { open = false; controller.close(); }
      }
    },
    cancel() { open = false; cancelled.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "private, no-store, no-transform", "X-Content-Type-Options": "nosniff", "X-Accel-Buffering": "no", "X-Vision-Model": model } });
}
