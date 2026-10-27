import sharp from "sharp";
import { PreviewError } from "@/lib/ai/openai";
import { CLIP_MODEL, analyzeClip, parseYouTubeId, youtubeThumbnail, type ClipSource } from "@/lib/sourcing/clip-vision";
import { checkOrigin, createGuard, readForm, streamLook } from "@/lib/sourcing/look-stream";

// Gemini gets its own 90s to watch the clip, then sourcing keeps the usual 30s budget.
export const maxDuration = 150;
const ANALYSIS_MS = 90_000;

const MAX_VIDEO = 4 * 1024 * 1024;
const MAX_BODY = MAX_VIDEO + 512 * 1024; // clip plus the reference frame, under Vercel's 4.5 MB cap
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const guard = createGuard();

async function jpeg(file: File) {
  try {
    const input = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 });
    const meta = await input.metadata();
    if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 64) throw new Error("Invalid image");
    return await input.rotate().flatten({ background: "#ffffff" }).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } catch { throw new PreviewError(400, "The frame from your clip could not be read. Try again."); }
}

/** A YouTube link, or an uploaded clip with a frame captured in the browser. */
async function readInput(request: Request, signal: AbortSignal): Promise<{ source: ClipSource; image: Buffer }> {
  const form = await readForm(request, MAX_BODY, "Trim the clip to under 4 MB and try again.", "Add a YouTube link or a clip.");
  const link = form.get("youtube");
  if (typeof link === "string" && link.trim()) {
    const id = parseYouTubeId(link);
    if (!id) throw new PreviewError(400, "That doesn’t look like a YouTube link. Paste a youtube.com or youtu.be video link.");
    return { source: { kind: "youtube", id }, image: await youtubeThumbnail(id, signal) };
  }
  const clip = form.get("clip");
  const frame = form.get("frame");
  if (!(clip instanceof File) || !clip.size) throw new PreviewError(400, "Add a YouTube link or choose a clip.");
  if (clip.size > MAX_VIDEO) throw new PreviewError(413, "Trim the clip to under 4 MB and try again.");
  if (!VIDEO_TYPES.includes(clip.type)) throw new PreviewError(400, "Use an MP4, WebM or MOV clip.");
  if (!(frame instanceof File) || !frame.size) throw new PreviewError(400, "The frame from your clip is missing. Try choosing the clip again.");
  return { source: { kind: "upload", data: Buffer.from(await clip.arrayBuffer()), mime: clip.type }, image: await jpeg(frame) };
}

export async function POST(request: Request) {
  const respond = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Vision-Model": CLIP_MODEL } });
  let reserved = false;
  let input: Awaited<ReturnType<typeof readInput>>;
  try {
    checkOrigin(request, "Open the clip stylist from this site.");
    if (!process.env.GEMINI_API_KEY || !process.env.OPENAI_API_KEY || !process.env.FIRECRAWL_API_KEY) throw new PreviewError(503, "The clip stylist is not available yet.");
    input = await readInput(request, request.signal);
    guard.reserve(); reserved = true;
  } catch (error) {
    if (reserved) guard.release();
    if (error instanceof PreviewError) return respond(error.status, { error: error.message });
    return respond(400, { error: "The upload could not be read. Please try again." });
  }
  return streamLook({
    request, model: CLIP_MODEL, image: input.image, release: guard.release, analysisMs: ANALYSIS_MS,
    analyze: async (signal, log) => {
      const { look, bestFrameSeconds } = await analyzeClip(input.source, signal);
      log("look", `Best view of the outfit around ${Math.floor(bestFrameSeconds / 60)}:${String(Math.floor(bestFrameSeconds % 60)).padStart(2, "0")}`);
      return look;
    },
    readingText: "Watching the clip. This takes a little longer than a still…",
    timeoutText: "We couldn’t finish this clip in time. Try a shorter clip or a closer shot of the costume.",
    failureText: "The stylist couldn’t read this clip. Please try again.",
  });
}
