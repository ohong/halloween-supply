import { lucyRealtime } from "@fal-ai/client/realtime";
import type { RealtimeConnectionHandler } from "@fal-ai/client";

export type VideoFailure = { code: "billing" | "auth" | "capacity" | "input" | "network" | "timeout" | "connection"; message: string; retryable: boolean };

/** Classify provider evidence without exposing its payload, credentials, or URLs. */
export function videoFailureFor(error: unknown): VideoFailure {
  const parts: string[] = [];
  const collect = (value: unknown, depth = 0) => {
    if (depth > 3) return;
    if (typeof value === "string" || typeof value === "number") parts.push(String(value).slice(0, 1000));
    else if (value && typeof value === "object") {
      for (const key of ["message", "error", "reason", "detail", "code", "status", "body"]) {
        if (key in value) collect((value as Record<string, unknown>)[key], depth + 1);
      }
    }
  };
  collect(error);
  const text = parts.join(" ").toLowerCase();
  if (/insufficient.*(?:credit|balance)|needs? account credit|billing|payment|credit.*exhaust|balance.*low/.test(text)) return {
    code: "billing", retryable: false, message: "The live video provider needs account credit. Your phone can stay connected; use photo mode for now.",
  };
  if (/unauthori[sz]ed|forbidden|rejected.*access|invalid.*(?:key|token)|\b401\b|\b403\b/.test(text)) return {
    code: "auth", retryable: false, message: "The live video provider rejected access. Use photo mode while access is restored.",
  };
  if (/concurren|capacity|too many|rate.limit|\b429\b|resource.exhaust|session.limit/.test(text)) return {
    code: "capacity", retryable: true, message: "The live video provider is at its session limit. Your phone can stay connected. Retry the mirror or use photo mode.",
  };
  if (/invalid.*(?:input|prompt|request)|validation|\b422\b/.test(text)) return {
    code: "input", retryable: false, message: "The live video provider could not accept this outfit. Choose another costume or use photo mode.",
  };
  return {
    code: /\bice\b|network|transport/.test(text) ? "network" : /timed? out|timeout|in time/.test(text) ? "timeout" : "connection",
    retryable: true,
    message: "The live video provider could not connect. Retry the mirror or use photo mode. Your phone connection can stay open.",
  };
}

/** The pinned Lucy extension drops the reason from its signaling error frame. */
export function lucyWithFailures(model: string, onFailure: (failure: VideoFailure) => void) {
  const extension = lucyRealtime({ endpoints: [model] });
  return {
    ...extension,
    open: (...[context, options]: Parameters<typeof extension.open>) => extension.open({
      ...context,
      connect: <Input, Output>(endpoint: string, handler: RealtimeConnectionHandler<Output>) => context.connect<Input, Output>(endpoint, {
        ...handler,
        onResult: result => {
          if (result && typeof result === "object" && "type" in result && result.type === "error") onFailure(videoFailureFor(result));
          handler.onResult(result);
        },
      }),
    }, options),
  };
}
