"use client";

import posthog from "posthog-js";
import { useEffect } from "react";

// Replaces the root layout when it crashes, so it renders its own document and cannot rely on global styles.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    if (posthog.__loaded) posthog.captureException(error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 1.5rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.25rem" }}>Something went wrong</h1>
        <p>Please try again. If it keeps happening, come back in a few minutes.</p>
        <button onClick={() => retry()} style={{ padding: "0.5rem 1rem" }}>Try again</button>
      </body>
    </html>
  );
}
