import { z } from "zod";
import { readVideoJson, reserveVideoRequest, VIDEO_MODEL, VIDEO_SESSION_SECONDS, VideoError, videoFailure, videoRequestOrigin, videoResponse } from "@/lib/live-mirror/video-server";

export const maxDuration = 30;

export async function GET() {
  return videoResponse({ videoAvailable: Boolean(process.env.DECART_API_KEY), voiceAvailable: Boolean(process.env.OPENAI_API_KEY) });
}

export async function POST(request: Request) {
  try {
    z.object({ consent: z.literal(true) }).strict().parse(await readVideoJson(request));
    if (!process.env.DECART_API_KEY) throw new VideoError(503, "Live video try-on is not available yet. You can still build your outfit and use photo try-on.");
    reserveVideoRequest(request, "token");
    // Same contract as SDK tokens.create, with a bounded, abortable request.
    const response = await fetch("https://api.decart.ai/v1/client/tokens", {
      method: "POST",
      headers: { "X-API-KEY": process.env.DECART_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        expiresIn: 60,
        allowedModels: [VIDEO_MODEL],
        allowedOrigins: [videoRequestOrigin(request)],
        constraints: { realtime: { maxSessionDuration: VIDEO_SESSION_SECONDS } },
      }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
      cache: "no-store",
    });
    if (!response.ok) throw new VideoError(response.status === 429 ? 429 : 502, "The live video service is unavailable. Please try again later.");
    const token = z.object({ apiKey: z.string().min(1), expiresAt: z.string() }).parse(await response.json());
    return videoResponse({ apiKey: token.apiKey, expiresAt: token.expiresAt, model: VIDEO_MODEL, maxSessionSeconds: VIDEO_SESSION_SECONDS });
  } catch (error) { return videoFailure(error); }
}
