"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Scrolling message list that sticks to the bottom unless the reader scrolled up. */
export function Conversation({ children, trigger }: { children: ReactNode; trigger: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [trigger]);

  return (
    <div
      ref={ref}
      role="log"
      aria-live="polite"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4"
    >
      {children}
    </div>
  );
}
