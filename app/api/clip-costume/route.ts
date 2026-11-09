import sharp from "sharp";
import { PreviewError } from "@/lib/ai/openai";
import { analyzeClip, clipEnabled, clipModel, parseYouTubeId, type ClipSource } from "@/lib/sourcing/clip-vision";
import { screenshotSourcing, type SourcingLog } from "@/lib/sourcing/screenshot";
import { toCartItem } from "@/lib/custom-looks/source";
import { signSourcedItem } from "@/lib/custom-looks/item-proof";
import { guardProvider, UNAVAILABLE, type Release } from "@/lib/guard";

export const maxDuration = 150;
const ANALYSIS_MS = 90_000;
const SEARCH_MS = 30_000;
const MAX_VIDEO = 4 * 1024 * 1024;
const MAX_FRAME = 200 * 1024;
// Include multipart overhead while staying below the deployed function's 4.5 MB body cap.
const MAX_BODY = 4_500_000;
const guard = guardProvider("clip-costume", { maxActive: 4 });

const headers = () => ({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Vision-Model": clipModel() ?? "unconfigured" });

export function GET() {
  return Response.json({ enabled: clipEnabled() }, { headers: headers() });
}

async function readInput(request: Request): Promise<{ source: ClipSource; image: Buffer | null }> {
  const contentType = request.headers.get("content-type");
  if (!contentType?.startsWith("multipart/form-data")) throw new PreviewError(400, "Add a YouTube link or a clip.");
  if (Number(request.headers.get("content-length")) > MAX_BODY) throw new PreviewError(413, "Trim the clip to under 4 MB and try again.");
  const reader = request.body?.getReader();
  if (!reader) throw new PreviewError(400, "Add a YouTube link or a clip.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new PreviewError(413, "Trim the clip to under 4 MB and try again."); }
    chunks.push(value);
  }
  let form: FormData;
  try { form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": contentType } }).formData(); }
  catch { throw new PreviewError(400, "The upload could not be read. Choose the clip again."); }
  const link = form.get("youtube");
  const clip = form.get("clip");
  const hasLink = typeof link === "string" && !!link.trim();
  if (hasLink && clip instanceof File && clip.size) throw new PreviewError(400, "Choose a YouTube link or an upload, one at a time.");
  if (hasLink) {
    const id = parseYouTubeId(link);
    if (!id) throw new PreviewError(400, "Paste a public youtube.com or youtu.be video link.");
    // Only the validated ID reaches Gemini. This server never fetches the pasted URL or a thumbnail.
    return { source: { kind: "youtube", id }, image: null };
  }
  if (!(clip instanceof File) || !clip.size) throw new PreviewError(400, "Choose a clip or add a YouTube link.");
  if (clip.size > MAX_VIDEO) throw new PreviewError(413, "Trim the clip to under 4 MB and try again.");
  if (!["video/mp4", "video/webm", "video/quicktime"].includes(clip.type)) throw new PreviewError(400, "Use an MP4, WebM or MOV clip.");
  const data = Buffer.from(await clip.arrayBuffer());
  const signature = data.subarray(4, 8).toString("ascii");
  const isWebm = data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (clip.type === "video/webm" ? !isWebm : !["ftyp", "moov", "mdat", "wide", "free"].includes(signature))
    throw new PreviewError(400, "This clip could not be read. Try an MP4 exported by your video app.");
  const frame = form.get("frame");
  if (!(frame instanceof File) || !frame.size) throw new PreviewError(400, "The reference frame is missing. Choose the clip again.");
  if (frame.size > MAX_FRAME) throw new PreviewError(413, "The reference frame is too large. Choose the clip again.");
  let image: Buffer;
  try {
    const input = sharp(Buffer.from(await frame.arrayBuffer()), { limitInputPixels: 20_000_000 });
    const meta = await input.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || !meta.width || !meta.height || Math.min(meta.width, meta.height) < 64) throw new Error("Invalid frame");
    image = await input.rotate().flatten({ background: "#ffffff" }).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } catch { throw new PreviewError(400, "The reference frame could not be read. Choose the clip again."); }
  return { source: { kind: "upload", data, mime: clip.type === "video/quicktime" ? "video/mov" : clip.type }, image };
}

export async function POST(request: Request) {
  const respond = (status: number, error: string) => Response.json({ error }, { status, headers: headers() });
  let input: Awaited<ReturnType<typeof readInput>>;
  let release: Release | undefined;
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new PreviewError(403, "Open the clip stylist from this site.");
    if (!clipEnabled()) throw new PreviewError(503, "The clip stylist is not available yet.");
    // Reserve before reading a potentially slow upload, and release on every exit.
    const lease = guard.acquire();
    if (lease === "disabled") throw new PreviewError(503, UNAVAILABLE);
    if (lease === "busy") throw new PreviewError(429, "The clip stylist is busy. Please try again shortly.");
    release = lease;
    try { input = await readInput(request); } catch (error) { release(); throw error; }
  } catch (error) {
    return error instanceof PreviewError ? respond(error.status, error.message) : respond(400, "The upload could not be read. Please try again.");
  }
  const t0 = performance.now();
  const cancelled = new AbortController();
  const deadline = new AbortController();
  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: Record<string, unknown>) => { if (open) controller.enqueue(encoder.encode(`${JSON.stringify({ ...event, ms: Math.round(performance.now() - t0) })}\n`)); };
      const log: SourcingLog = (kind, text) => emit({ t: "log", kind, text });
      const analysisDeadline = AbortSignal.timeout(ANALYSIS_MS);
      const analysisSignal = AbortSignal.any([request.signal, cancelled.signal, analysisDeadline]);
      const signal = AbortSignal.any([request.signal, cancelled.signal, deadline.signal]);
      const matched = new Set<number>();
      const priced = new Set<number>();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        log("think", "Watching the clip. Results appear after the outfit is read…");
        const { look, bestFrameSeconds } = await analyzeClip(input.source, analysisSignal);
        analysisSignal.throwIfAborted();
        emit({ t: "look", ...look, bestFrameSeconds });
        log("look", `Clearest outfit view around ${Math.floor(bestFrameSeconds / 60)}:${String(Math.floor(bestFrameSeconds % 60)).padStart(2, "0")}.`);
        if (!input.image) log("look", "YouTube results are shop links. Upload a clip to compare product photos against your chosen frame.");
        timer = setTimeout(() => deadline.abort(new DOMException("Search budget reached", "TimeoutError")), SEARCH_MS);
        const source = screenshotSourcing(signal, log, input.image);
        const work = Promise.allSettled(look.pieces.map((piece, i) => source(piece, match => {
          if (signal.aborted) return;
          if (!match) { matched.delete(i); emit({ t: "miss", i }); return; }
          matched.add(i); emit({ t: "candidate", i, match });
        }, hit => {
          if (signal.aborted) return;
          matched.add(i); priced.add(i);
          const sizedPiece = piece.sizeKind === "one_size" && /harness/i.test(piece.name) && hit.sizes.some(size => !/^one[ -]?size$|^default title$/i.test(size))
            ? { ...piece, sizeKind: "apparel" as const } : piece;
          const item = toCartItem(i, sizedPiece, hit);
          emit({ t: "piece", i, item, proof: signSourcedItem(item), why: hit.why ?? "Similar style. Colors and details may differ." });
        })));
        await Promise.race([work, new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener("abort", () => resolve(), { once: true }); })]);
        if (!request.signal.aborted && !cancelled.signal.aborted) {
          for (let i = 0; i < look.pieces.length; i++) if (!matched.has(i)) emit({ t: "miss", i });
          emit({ t: "done", found: matched.size, priced: priced.size, timedOut: deadline.signal.aborted });
        }
      } catch (error) {
        if (!request.signal.aborted && !cancelled.signal.aborted) emit({ t: "error", text: error instanceof PreviewError ? error.message
          : analysisDeadline.aborted ? "We couldn’t finish this clip in time. Try a shorter clip."
          : "The clip stylist could not finish. Matches already found stay on your board." });
      } finally {
        clearTimeout(timer); deadline.abort(); release?.();
        if (open) { open = false; controller.close(); }
      }
    },
    cancel() { open = false; cancelled.abort(); },
  });
  return new Response(stream, { headers: { ...headers(), "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no" } });
}
