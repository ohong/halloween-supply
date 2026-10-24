"use client";

import { CheckCircleIcon, ChevronDownIcon, CircleIcon, ClockIcon, XCircleIcon } from "lucide-react";
import type { ToolUIPart } from "ai";
import type { ComponentProps, ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// Adapted from Vercel AI Elements (Apache-2.0). Display shopper-facing lookup
// summaries rather than developer parameters, tool names or raw JSON.
// https://github.com/vercel/ai-elements/blob/main/packages/elements/src/tool.tsx
export function Tool({ className, ...props }: ComponentProps<typeof Collapsible>) {
  return <Collapsible className={cn("group/tool w-full rounded-[4px] border border-[#CCC]", className)} {...props} />;
}

export function ToolHeader({ title, state }: { title: string; state: ToolUIPart["state"] }) {
  const Icon = state === "output-available" ? CheckCircleIcon : state === "output-error" || state === "output-denied" ? XCircleIcon : state === "input-streaming" ? CircleIcon : ClockIcon;
  const status = state === "output-available" ? "Done" : state === "output-error" || state === "output-denied" ? "Could not finish" : "Working";
  return <CollapsibleTrigger className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-xs text-[#666] outline-none focus-visible:ring-2 focus-visible:ring-[#111]"><Icon className="size-3.5 shrink-0" aria-hidden /><span className="flex-1">{title}</span><span className="sr-only">{status}</span><ChevronDownIcon className="size-3.5 shrink-0 transition-transform duration-150 group-data-[state=open]/tool:rotate-180" aria-hidden /></CollapsibleTrigger>;
}

export function ToolContent({ className, ...props }: ComponentProps<typeof CollapsibleContent>) {
  return <CollapsibleContent className={cn("px-3 pb-3 text-xs leading-relaxed text-[#666]", className)} {...props} />;
}

export function ToolOutput({ children, error }: { children: ReactNode; error?: boolean }) {
  return <div role={error ? "alert" : undefined}>{children}</div>;
}
