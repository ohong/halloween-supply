import { createHash } from "node:crypto";
import sharp from "sharp";
import { SCREENSHOT_VISION_MODEL as MODEL, decomposeScreenshot as decompose } from "@/lib/sourcing/screenshot-vision";
import { PreviewError } from "@/lib/ai/openai";
import { screenshotSourcing, type SourcingLog as Log } from "@/lib/sourcing/screenshot";
import { toCartItem } from "@/lib/custom-looks/source";

export const maxDuration = 120;

const MAX_BODY = 4 * 1024 * 1024;
const FORMATS = ["jpeg", "png", "webp", "gif", "heif", "avif"];
// A local cost guard, not a distributed quota, mirroring the try-on route.
const attempts = new Map<string, { count: number; expires: number }>();
let active = 0;
function reserve(request: Request) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key);
  const address = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const id = createHash("sha256").update(address).digest("hex");
  const entry = attempts.get(id) ?? { count: 0, expires: now + 3_600_000 };
  if (entry.count >= 20) throw new PreviewError(429, "You’ve built twenty looks this hour. Please try again later.");
  if (active >= 4 || attempts.size >= 2000) throw new PreviewError(429, "The stylist is busy. Please try again shortly.");
  attempts.set(id, { ...entry, count: entry.count + 1 });
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
    return await input.rotate().flatten({ background: "#ffffff" }).resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  } catch { throw new PreviewError(400, "This image could not be read. Try a JPEG, PNG or WebP screenshot."); }
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export async function POST(request: Request) {
  const respond = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Vision-Model": MODEL } });
  let reserved = false;
  let image: Buffer;
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new PreviewError(403, "Open the screenshot stylist from this site.");
    if (!process.env.OPENAI_API_KEY || !process.env.FIRECRAWL_API_KEY) throw new PreviewError(503, "The screenshot stylist is not available yet.");
    image = await readPhoto(request);
    reserve(request); reserved = true;
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
      const signal = AbortSignal.any([request.signal, cancelled.signal, AbortSignal.timeout(105_000)]);
      try {
        log("think", "Reading the screenshot…");
        const look = await decompose(image, signal, log);
        emit({ t: "look", ...look });
        log("look", `Spotted ${look.character}: ${look.pieces.map((p) => p.name.toLowerCase()).join(", ")}`);

        const source = screenshotSourcing(signal, log, image);
        let found = 0;
        await Promise.all(look.pieces.map(async (piece, i) => {
          const hit = await source(piece);
          if (signal.aborted) return;
          if (!hit) { log("fail", `${piece.name}: no verified match yet`); emit({ t: "miss", i }); return; }
          found++;
          log("found", `${piece.name} → ${hit.merchant}, ${money(hit.priceCents)}`);
          const sizedPiece = piece.sizeKind === "one_size" && /harness/i.test(piece.name) && hit.sizes.some((size) => !/^one[ -]?size$|^default title$/i.test(size))
            ? { ...piece, sizeKind: "apparel" as const } : piece;
          emit({
            t: "piece", i, fit: hit.fit ?? "close", why: hit.why ?? piece.query,
            product: { title: hit.title, image: hit.image, url: hit.url, priceCents: hit.priceCents, merchant: hit.merchant },
            item: toCartItem(i, sizedPiece, hit),
          });
        }));
        if (signal.aborted) throw new DOMException("Timed out", "TimeoutError");
        emit({ t: "done", found });
      } catch (error) {
        const text = error instanceof PreviewError ? error.message
          : error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name) ? "The stylist took too long. Please try again."
          : "The stylist couldn’t finish this look. Please try again.";
        if (!(error instanceof PreviewError)) console.warn("[screenshot-costume] failed", error instanceof Error ? error.name : "UnknownError");
        emit({ t: "error", text });
      } finally {
        active--;
        if (open) { open = false; controller.close(); }
      }
    },
    cancel() { open = false; cancelled.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Vision-Model": MODEL } });
}
