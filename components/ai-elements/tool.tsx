"use client";

import { CheckIcon, CircleAlertIcon } from "lucide-react";
import type { ToolUIPart } from "ai";
import { cn } from "@/lib/utils";
import { Shimmer } from "./shimmer";

// Adapted from Vercel AI Elements (Apache-2.0). The upstream Tool is a
// collapsible developer panel; shoppers only need one quiet line saying what
// was looked up and what came back, so this renders a status row instead.
// https://github.com/vercel/ai-elements/blob/main/packages/elements/src/tool.tsx
export function Tool({ title, state, summary, className }: { title: string; state: ToolUIPart["state"]; summary: string; className?: string }) {
  const failed = state === "output-error" || state === "output-denied";
  const done = state === "output-available";
  return (
    <div className={cn("ai-tool", failed && "is-error", className)} role={failed ? "alert" : undefined}>
      <span className="ai-tool-icon" aria-hidden>
        {failed ? <CircleAlertIcon /> : done ? <CheckIcon /> : <span className="ai-tool-dot" />}
      </span>
      <p className="min-w-0">
        {done || failed ? <span className="ai-tool-title">{title}</span> : <Shimmer className="ai-tool-title">{title}</Shimmer>}
        {(done || failed) && <span className="ai-tool-summary"> · {summary}</span>}
      </p>
    </div>
  );
}
