import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Adapted from Vercel AI Elements (Apache-2.0): text that shimmers while work is in flight.
// https://github.com/vercel/ai-elements/blob/main/packages/elements/src/shimmer.tsx
export function Shimmer({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("ai-shimmer", className)} {...props} />;
}
