"use client";

import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Vercel AI Elements (Apache-2.0), reduced to the conversation primitives in use.
// https://github.com/vercel/ai-elements/blob/main/packages/elements/src/conversation.tsx
export function Conversation({ className, ...props }: ComponentProps<typeof StickToBottom>) {
  return <StickToBottom className={cn("relative min-h-0 flex-1 overflow-y-hidden", className)} initial="instant" resize="instant" role="log" {...props} />;
}

export function ConversationContent({ className, ...props }: ComponentProps<typeof StickToBottom.Content>) {
  return <StickToBottom.Content className={cn("flex flex-col gap-3 p-4", className)} {...props} />;
}

export function ConversationScrollButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  return !isAtBottom && <Button variant="outline" size="icon" aria-label="Scroll to latest message" className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full" onClick={() => { void scrollToBottom(); }}><ArrowDownIcon /></Button>;
}
