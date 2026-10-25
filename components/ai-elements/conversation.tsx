"use client";

import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { cn } from "@/lib/utils";

// Vercel AI Elements (Apache-2.0), reduced to the conversation primitives in use.
// https://github.com/vercel/ai-elements/blob/main/packages/elements/src/conversation.tsx
export function Conversation({ className, ...props }: ComponentProps<typeof StickToBottom>) {
  return <StickToBottom className={cn("relative min-h-0 flex-1 overflow-y-hidden", className)} initial="instant" resize="instant" role="log" {...props} />;
}

export function ConversationContent({ className, ...props }: ComponentProps<typeof StickToBottom.Content>) {
  return <StickToBottom.Content className={cn("flex flex-col gap-5 px-4 pt-4 pb-6", className)} {...props} />;
}

export function ConversationScrollButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  return !isAtBottom && <button type="button" aria-label="Scroll to latest message" className="ai-scroll-button" onClick={() => { void scrollToBottom(); }}><ArrowDownIcon className="size-4" aria-hidden /></button>;
}
