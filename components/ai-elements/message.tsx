"use client";

import type { UIMessage } from "ai";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Adapted from Vercel AI Elements (Apache-2.0). Only the plain-text primitives
// are needed: this assistant deliberately emits no markdown or code blocks.
// https://github.com/vercel/ai-elements/blob/main/packages/elements/src/message.tsx
export function Message({ className, from, ...props }: HTMLAttributes<HTMLDivElement> & { from: UIMessage["role"] }) {
  return <div className={cn("group flex w-full flex-col gap-2", from === "user" ? "is-user ml-auto items-end" : "is-assistant items-start", className)} {...props} />;
}

export function MessageContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-w-0 max-w-full flex-col gap-2 text-sm group-[.is-user]:max-w-[85%] group-[.is-user]:rounded-[4px] group-[.is-user]:bg-[#111] group-[.is-user]:px-3 group-[.is-user]:py-2 group-[.is-user]:text-white group-[.is-assistant]:text-[#333]", className)} {...props} />;
}
