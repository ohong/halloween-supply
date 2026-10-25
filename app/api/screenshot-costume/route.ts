import sharp from "sharp";
import { SCREENSHOT_VISION_MODEL as MODEL, decomposeScreenshot as decompose } from "@/lib/sourcing/screenshot-vision";
import { PreviewError } from "@/lib/ai/openai";
import { checkOrigin, createGuard, readForm, streamLook } from "@/lib/sourcing/look-stream";

export const maxDuration = 40;

const MAX_BODY = 4 * 1024 * 1024;
const FORMATS = ["jpeg", "png", "webp", "gif", "heif", "avif"];
const guard = createGuard();

async function readPhoto(request: Request) {
  const form = await readForm(request, MAX_BODY, "Choose an image smaller than 4 MB.", "Upload a screenshot with the form.");
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
  const respond = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Vision-Model": MODEL } });
  let reserved = false;
  let image: Buffer;
  try {
    checkOrigin(request, "Open the screenshot stylist from this site.");
    if (!process.env.OPENAI_API_KEY || !process.env.FIRECRAWL_API_KEY) throw new PreviewError(503, "The screenshot stylist is not available yet.");
    image = await readPhoto(request);
    guard.reserve(); reserved = true;
  } catch (error) {
    if (reserved) guard.release();
    if (error instanceof PreviewError) return respond(error.status, { error: error.message });
    return respond(400, { error: "The upload could not be read. Please try again." });
  }
  return streamLook({
    request, model: MODEL, image, release: guard.release,
    analyze: signal => decompose(image, signal),
    readingText: "Reading the visible pieces. Results appear as soon as we find them…",
    timeoutText: "We couldn’t read this screenshot within 30 seconds. Try a closer crop of the outfit.",
    failureText: "The stylist couldn’t read this look. Please try again.",
  });
}
