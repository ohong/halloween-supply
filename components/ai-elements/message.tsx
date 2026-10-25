"use client";

import type { UIMessage } from "ai";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Adapted from Vercel AI Elements (Apache-2.0). The prompt asks for plain text,
// but models still slip in bold and bullets, so MessageResponse renders that
// small subset instead of showing raw asterisks. No links, HTML or headings.
// https://github.com/vercel/ai-elements/blob/main/packages/elements/src/message.tsx
export function Message({ className, from, ...props }: HTMLAttributes<HTMLDivElement> & { from: UIMessage["role"] }) {
  return <div className={cn("ai-message group flex w-full flex-col gap-2.5", from === "user" ? "is-user items-end" : "is-assistant items-start", className)} {...props} />;
}

export function MessageContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ai-message-content", className)} {...props} />;
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((chunk, i) => (chunk.startsWith("**") && chunk.endsWith("**") && chunk.length > 4 ? <strong key={i}>{chunk.slice(2, -2)}</strong> : chunk));
}

export function MessageResponse({ children }: { children: string }) {
  const blocks: ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length) blocks.push(<ul key={blocks.length}>{items.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>);
    items = [];
  };
  for (const paragraph of children.trim().split(/\n{2,}/)) {
    for (const line of paragraph.split("\n")) {
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      if (bullet) { items.push(bullet[1]); continue; }
      flush();
      if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    }
    flush();
  }
  return <div className="ai-response">{blocks}</div>;
}
