import { trackEvent } from "@/lib/telemetry/client";

export type MirrorTimingStage = "parse" | "state_applied" | "provider_connect" | "provider_send" | "first_frame";

/** Timings describe transport and state work, never garment-render fidelity. */
export function recordMirrorTiming(stage: MirrorTimingStage, startedAt: number, mode: "voice" | "text" | "video") {
  const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 600_000) return;
  trackEvent("source_timing", { source: "mirror", stage, mode, durationMs });
  // Local runtime checks use the same anonymous measurements as telemetry.
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("mirror-timing", { detail: { stage, mode, durationMs } }));
}
