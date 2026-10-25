import { useState } from "react";
import "./assembly-status.css";

export function AssemblyStatus({ found, total, missing = 0, running, stopped = false }: {
  found: number; total: number; missing?: number; running: boolean; stopped?: boolean;
}) {
  const pending = Math.max(0, total - found - missing);
  return <p className="assembly-status" role="status" aria-atomic="true">
    <span className="assembly-status-mark" data-running={running} aria-hidden="true" />
    <span>{total === 0
      ? running ? "Finding the pieces in your look…" : "No pieces to assemble"
      : `${found} of ${total} pieces assembled${missing ? ` · ${missing} without a source` : ""}${stopped && pending ? ` · ${pending} unfinished` : ""}`}</span>
    {running && total > 0 && <span className="assembly-status-note">Adding each match as it arrives</span>}
  </p>;
}

export function AssemblyPlaceholder({ state, index }: { state: "looking" | "missing" | "stopped"; index: number }) {
  return <span className={`assembly-placeholder is-${state}`}>
    <span className="assembly-placeholder-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
    <span>{state === "missing" ? "No available source" : state === "stopped" ? "Search unfinished" : "Finding a match"}</span>
  </span>;
}

/** A merchant photo remains a photo; only reviewed cutouts use the bare canvas. */
export function AssemblyImage({ src, alt, cutout = false }: { src: string; alt: string; cutout?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  return <span className="assembly-image" data-cutout={cutout}>
    {failed === src
      ? <span className="assembly-image-missing">Photo unavailable</span>
      // eslint-disable-next-line @next/next/no-img-element -- catalog images include arbitrary merchant hosts
      : <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(src)} />}
  </span>;
}
