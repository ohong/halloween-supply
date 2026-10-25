import { z } from "zod";
import { readVideoJson, VIDEO_MODEL, VIDEO_SESSION_SECONDS, VideoError, videoFailure, videoResponse } from "@/lib/live-mirror/video-server";

export const maxDuration = 30;

export async function GET() {
  return videoResponse({ videoAvailable: Boolean(process.env.FAL_KEY), voiceAvailable: Boolean(process.env.OPENAI_API_KEY), provider: "fal", model: VIDEO_MODEL, maxSessionSeconds: VIDEO_SESSION_SECONDS });
}

export async function POST(request: Request) {
  try {
    z.object({ consent: z.literal(true) }).strict().parse(await readVideoJson(request));
    if (!process.env.FAL_KEY) throw new VideoError(503, "Live video try-on is unavailable. You can still build your outfit and use photo try-on.");
    // fal scopes tokens to the app alias (owner/model), not its /realtime path.
    // This short-lived token authenticates signaling; it is not a session timer.
    const response = await fetch("https://rest.fal.ai/tokens/", {
      method: "POST",
      headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ allowed_apps: ["decart/lucy-2-5"], token_expiration: 60 }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      cache: "no-store",
    });
    if (!response.ok) throw new VideoError(response.status === 429 ? 429 : 502, "The live video service is unavailable. Please try again later.");
    const result: unknown = await response.json();
    const token = z.string().min(1).parse(typeof result === "object" && result && "detail" in result ? result.detail : result);
    return videoResponse({ token, model: VIDEO_MODEL, maxSessionSeconds: VIDEO_SESSION_SECONDS });
  } catch (error) { return videoFailure(error); }
}
