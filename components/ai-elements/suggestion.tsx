"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Adapted from Vercel AI Elements (Apache-2.0): one-tap starter prompts.
// https://github.com/vercel/ai-elements/blob/main/packages/elements/src/suggestion.tsx
export function Suggestions({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("ai-suggestions", className)} {...props} />;
}

export function Suggestion({ suggestion, onClick, className, ...props }: Omit<ComponentProps<"button">, "onClick"> & { suggestion: string; onClick: (suggestion: string) => void }) {
  return <button type="button" className={cn("ai-suggestion", className)} onClick={() => onClick(suggestion)} {...props}>{suggestion}</button>;
}
