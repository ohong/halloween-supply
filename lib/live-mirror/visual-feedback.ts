import type { MirrorCommand } from "./types";
import { readMirrorResponse } from "./read-response";

export type FeedbackFrames = { preview: string; frozen: boolean } & (
  | { mode: "style"; original?: never }
  | { mode: "likeness"; original: string }
);

/** Capture only when asked. These frames never enter application storage. */
export function captureFeedbackFrame(element: HTMLVideoElement | HTMLImageElement | null): string | null {
  if (!element) return null;
  const width = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth;
  const height = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight;
  if (!width || !height) return null;
  const scale = Math.min(1, 960 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  try {
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    const frame = canvas.toDataURL("image/jpeg", .8);
    return frame.length <= 700_000 ? frame : null;
  } catch { return null; }
}

export async function sendVisualFeedback(frames: FeedbackFrames, question: string, signal: AbortSignal): Promise<MirrorCommand> {
  const result = await readMirrorResponse<MirrorCommand>(await fetch("/api/live-mirror/feedback", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...frames, question, consent: true }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
  }));
  if (!Array.isArray(result.actions) || result.actions.length || typeof result.message !== "string" || !result.message.trim()) throw new Error("The visual assessment could not be read. Please ask again.");
  return result;
}
