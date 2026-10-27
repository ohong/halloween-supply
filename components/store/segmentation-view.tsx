import type { CSSProperties } from "react";

/** One outline is a list of polygons; each polygon is a list of [x, y] points in the segmentation image frame. */
export type Outline = number[][][];
export interface Segmentation { image: { width: number; height: number }; person: { outline?: Outline }; timings_ms: Record<string, number> }
export interface PieceVisionInfo {
  crop: string;
  colors: { name: string; hex: string; frac: number }[];
  garmentTypes: { phrase: string; score: number }[];
  region?: string;
  pattern?: "solid" | "patterned";
  outline?: Outline;
  query?: string;
}

// Head to toe, one color per piece index. Chosen to stay distinct on photos and on white.
export const PIECE_COLORS = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#00a6a6", "#c9a400", "#d6336c"];
export const pieceColor = (i: number) => PIECE_COLORS[i % PIECE_COLORS.length];

const toPath = (outline: Outline) =>
  outline.map(poly => poly.length ? `M${poly.map(([x, y]) => `${x} ${y}`).join("L")}Z` : "").join("");

const STYLE = `
@keyframes seg-in { from { opacity: 0; } to { opacity: 1; } }
.seg-piece { animation: seg-in .45s ease-out both; transition: fill-opacity .15s, stroke-opacity .15s, stroke-width .15s; }
@media (prefers-reduced-motion: reduce) { .seg-piece { animation: none; transition: none; } }
`;

/** Draws the person silhouette and each piece outline over the screenshot preview. `slice` matches the preview's object-fit: cover. */
export function SegmentationOverlay({ segmentation, vision, active }: { segmentation: Segmentation; vision: PieceVisionInfo[]; active: number | null }) {
  const { width, height } = segmentation.image;
  const person = segmentation.person.outline;
  return <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true"
    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
    <style>{STYLE}</style>
    {person && <path d={toPath(person)} fill="none" stroke="#fff" strokeOpacity={0.6} strokeWidth={2} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />}
    {vision.map((v, i) => {
      if (!v.outline?.length) return null;
      const on = active === i;
      const dim = active !== null && !on;
      return <path key={i} className="seg-piece" d={toPath(v.outline)} fill={pieceColor(i)} stroke={pieceColor(i)}
        fillOpacity={on ? 0.5 : dim ? 0.1 : 0.25} strokeOpacity={dim ? 0.4 : 1} strokeWidth={on ? 3 : 2}
        vectorEffect="non-scaling-stroke" style={{ animationDelay: `${i * 120}ms` }} />;
    })}
  </svg>;
}

export function PieceDot({ index }: { index: number }) {
  return <span aria-hidden="true" style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: pieceColor(index), flex: "none" }} />;
}

/** The OpenCV stages in the order the service returned them, with their durations. */
export function PipelineStrip({ timings }: { timings: Record<string, number> }) {
  const stages = Object.entries(timings);
  if (!stages.length) return null;
  return <div aria-label="OpenCV pipeline" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px", marginBottom: 12, fontSize: 12 }}>
    <span className="meta">OpenCV pipeline</span>
    {stages.map(([stage, ms], i) => <span key={stage} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {i > 0 && <span aria-hidden="true" style={{ color: "var(--mid)" }}>→</span>}
      <span style={{ border: "1px solid var(--line)", borderRadius: 4, padding: "2px 6px", color: "var(--ink)" }}>
        {stage.replaceAll("_", " ")} <span style={{ color: "var(--mid)", fontVariantNumeric: "tabular-nums" }}>{Math.round(ms)} ms</span>
      </span>
    </span>)}
  </div>;
}

const row: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px", margin: 0, padding: 0, listStyle: "none" };

/** Segmentation evidence for one piece, shown under its card. Renders nothing when the service sent no region data. */
export function PieceVision({ vision, index }: { vision?: PieceVisionInfo; index: number }) {
  if (!vision || !vision.region) return null;
  return <div style={{ display: "grid", gap: 6, marginTop: 8, fontSize: 12 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <PieceDot index={index} />
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL crop from the vision service */}
      <img src={vision.crop} alt="The piece as OpenCV cropped it" style={{ width: 40, height: 40, objectFit: "contain", border: "1px solid var(--line)", background: "var(--bg)" }} />
      <span className="meta">{vision.region}{vision.pattern ? ` · ${vision.pattern}` : ""}</span>
    </div>
    <ul className="shot-swatches" aria-label="Colors found" style={row}>
      {vision.colors.map(c => <li key={c.hex}><span style={{ background: c.hex }} />{c.name} {Math.round(c.frac * 100)}%</li>)}
    </ul>
    {vision.garmentTypes.length > 0 && <p className="meta" style={{ margin: 0 }}>Looks like: {vision.garmentTypes.slice(0, 3).map(g => `${g.phrase} ${g.score.toFixed(2)}`).join(", ")}</p>}
    {vision.query && <p className="meta" style={{ margin: 0 }}>Query: “{vision.query}”</p>}
  </div>;
}
