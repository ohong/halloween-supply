import sharp from "sharp";
import { SCREENSHOT_VISION_MODEL as LUNA, decomposeScreenshot as decompose, labelSegments } from "@/lib/sourcing/screenshot-vision";
import { analyze, applyLabels, visionMode, visionModel, type TraceEntry, type VisionPiece } from "@/lib/sourcing/vision-client";
import { PreviewError } from "@/lib/ai/openai";
import { screenshotSourcing, type SourcingLog as Log } from "@/lib/sourcing/screenshot";
import { toCartItem } from "@/lib/custom-looks/source";

export const maxDuration = 40;
const SEARCH_BUDGET_MS = 30_000;
const MIN_PERSON_CONFIDENCE = 0.5;

const MAX_BODY = 4 * 1024 * 1024;
const FORMATS = ["jpeg", "png", "webp", "gif", "heif", "avif"];
// Bound simultaneous provider work without limiting repeated demo attempts.
let active = 0;
function reserve() {
  if (active >= 4) throw new PreviewError(429, "The stylist is busy. Please try again shortly.");
  active++;
}

async function readPhoto(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new PreviewError(400, "Upload a screenshot with the form.");
  if (Number(request.headers.get("content-length")) > MAX_BODY) throw new PreviewError(413, "Choose an image smaller than 4 MB.");
  const reader = request.body?.getReader();
  if (!reader) throw new PreviewError(400, "The screenshot is missing.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new PreviewError(413, "Choose an image smaller than 4 MB."); }
    chunks.push(value);
  }
  let form: FormData;
  try {
    form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type")! } }).formData();
  } catch { throw new PreviewError(400, "The upload could not be read. Please choose the image again."); }
  const photo = form.get("photo");
  if (!(photo instanceof File) || !photo.size) throw new PreviewError(400, "Choose a screenshot to read.");
  try {
    const input = sharp(Buffer.from(await photo.arrayBuffer()), { limitInputPixels: 40_000_000 });
    const meta = await input.metadata();
    if (!FORMATS.includes(meta.format ?? "") || !meta.width || !meta.height || Math.min(meta.width, meta.height) < 64) throw new Error("Invalid image");
    // Re-encode: strips metadata, flattens animation to one frame, and keeps the vision call small and fast.
    return await input.rotate().flatten({ background: "#ffffff" }).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } catch { throw new PreviewError(400, "This image could not be read. Try a JPEG, PNG or WebP screenshot."); }
}


export async function POST(request: Request) {
  let model = "unconfigured";
  const respond = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Vision-Model": model } });
  let reserved = false;
  let image: Buffer;
  let mode: "opencv" | "luna";
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new PreviewError(403, "Open the screenshot stylist from this site.");
    mode = visionMode();
    if (!process.env.FIRECRAWL_API_KEY || !process.env.OPENAI_API_KEY) throw new PreviewError(503, "The screenshot stylist is not available yet.");
    // OpenCV segments the look; luna still names each piece and writes its search query.
    model = mode === "luna" ? LUNA : `${await visionModel()}+${LUNA}`;
    image = await readPhoto(request);
    reserve(); reserved = true;
  } catch (error) {
    if (reserved) active--;
    if (error instanceof PreviewError) return respond(error.status, { error: error.message });
    return respond(400, { error: "The upload could not be read. Please try again." });
  }

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
      const timer = setTimeout(() => deadline.abort(new DOMException("Search budget reached", "TimeoutError")), SEARCH_BUDGET_MS);
      const signal = AbortSignal.any([request.signal, cancelled.signal, deadline.signal]);
      const matched = new Set<number>();
      const priced = new Set<number>();
      let pieceCount = 0;
      const trace: TraceEntry[] = [];
      const step = (piece: number | null, kind: TraceEntry["step"], detail: Record<string, unknown>) => {
        const entry = { t_ms: Math.round(performance.now() - t0), piece, step: kind, detail };
        trace.push(entry);
        emit({ t: "trace", ...entry });
      };
      try {
        log("think", "Reading the visible pieces. Results appear as soon as we find them…");
        let look: Awaited<ReturnType<typeof decompose>>;
        let seen: VisionPiece[] = [];
        let segmentation: Record<string, unknown> | undefined;
        if (mode === "luna") look = await decompose(image, signal);
        else {
          const analysis = await analyze(image, signal);
          step(null, "perceive", { person: analysis.person, timings_ms: analysis.timings_ms, pieces: analysis.pieces.map(p => ({
            id: p.id, region: p.region, slot: p.slot, area_frac: p.area_frac, pattern: p.pattern, query: p.query, alternate: p.alternate,
            colors: p.colors.map(c => ({ name: c.name, hex: c.hex, frac: c.frac })), garment_types: p.garment_types.map(g => ({ phrase: g.phrase, score: g.score })),
          })) });
          if (!analysis.person.found || analysis.person.confidence < MIN_PERSON_CONFIDENCE || !analysis.pieces.length)
            throw new PreviewError(422, "We couldn’t find one clear person in this screenshot. Crop it to one person, head to toe, and try again.");
          const segments = analysis.pieces.slice(0, 8);
          const labels = await labelSegments(image, segments.map(p => ({ region: p.region, crop_b64: p.crop_b64,
            colors: p.colors.slice(0, 3).map(c => c.name), guesses: p.garment_types.slice(0, 3).map(g => g.phrase) })), signal);
          ({ seen, look } = applyLabels(analysis, labels));
          step(null, "label", { model: LUNA, pieces: labels.pieces.map(l => ({ index: l.index, keep: l.keep, name: l.name, garment: l.garment, query: l.query })) });
          if (!look.pieces.length) throw new PreviewError(422, "We couldn’t find a wearable piece in this screenshot. Crop it to one person, head to toe, and try again.");
          if (analysis.image) segmentation = { image: analysis.image, person: { outline: analysis.person.outline }, timings_ms: analysis.timings_ms };
        }
        if (signal.aborted) signal.throwIfAborted();
        pieceCount = look.pieces.length;
        emit({ t: "look", ...look, segmentation, vision: seen.map(p => ({ crop: `data:image/jpeg;base64,${p.crop_b64}`, colors: p.colors.map(c => ({ name: c.name, hex: c.hex, frac: c.frac })),
          garmentTypes: p.garment_types.map(g => ({ phrase: g.phrase, score: g.score })), region: p.region, pattern: p.pattern, outline: p.outline, query: p.query })) });
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
        }, seen[i] && { seen: seen[i], index: i, deadline: t0 + SEARCH_BUDGET_MS, trace: step, onApproval: (hit, because) => {
          if (signal.aborted) return;
          matched.add(i);
          emit({ t: "approval", i, because, why: hit.why, item: toCartItem(i, piece, hit) });
        } })));
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
            : deadline.signal.aborted ? "We couldn’t read this screenshot within 30 seconds. Try a closer crop of the outfit."
            : "The stylist couldn’t read this look. Please try again.";
          emit({ t: "error", text });
        }
      } finally {
        if (mode === "opencv") console.log(JSON.stringify({ event: "screenshot_agent_trace", model, ms: Math.round(performance.now() - t0), trace }));
        clearTimeout(timer);
        deadline.abort();
        active--;
        if (open) { open = false; controller.close(); }
      }
    },
    cancel() { open = false; cancelled.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "private, no-store, no-transform", "X-Content-Type-Options": "nosniff", "X-Accel-Buffering": "no", "X-Vision-Model": model } });
}
