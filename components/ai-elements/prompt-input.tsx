"use client";

import { ArrowUpIcon, SquareIcon } from "lucide-react";
import type { ComponentProps, KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

// Adapted from Vercel AI Elements (Apache-2.0): a growing textarea with the
// submit control inside the field, so the composer reads as one object.
// https://github.com/vercel/ai-elements/blob/main/packages/elements/src/prompt-input.tsx
export function PromptInput({ className, ...props }: ComponentProps<"form">) {
  return <form className={cn("ai-prompt", className)} {...props} />;
}

export function PromptInputTextarea({ className, onKeyDown, ...props }: ComponentProps<"textarea">) {
  const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };
  return <textarea rows={1} className={cn("ai-prompt-textarea", className)} onKeyDown={submitOnEnter} {...props} />;
}

export function PromptInputSubmit({ busy, onStop, disabled, ...props }: ComponentProps<"button"> & { busy: boolean; onStop: () => void }) {
  return busy
    ? <button type="button" className="ai-prompt-submit" onClick={onStop} aria-label="Stop the reply" {...props}><SquareIcon className="size-3 fill-current" aria-hidden /></button>
    : <button type="submit" className="ai-prompt-submit" disabled={disabled} aria-label="Send message" {...props}><ArrowUpIcon className="size-4" aria-hidden /></button>;
}
