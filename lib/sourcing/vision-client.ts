import { z } from "zod";
import { PreviewError } from "@/lib/ai/openai";
import type { ScreenshotLook } from "./screenshot-vision";

// Client for the OpenCV vision service (plans/contract.md v1). It never falls back to luna on its own.
const REGIONS = ["hat", "upper_clothes", "dress", "skirt", "pants", "belt", "shoes", "bag", "scarf", "sunglasses"] as const;
const SLOTS = ["head", "top", "outer", "bottom", "feet", "accessory"] as const;
const SIZE_KINDS = ["apparel", "pants", "shoe", "hat", "one_size"] as const;
const REASONS = ["color_mismatch", "type_mismatch", "no_garment", "low_quality"] as const;

const color = z.object({ name: z.string(), hex: z.string(), lab: z.array(z.number()).length(3), frac: z.number() });
const garmentType = z.object({ phrase: z.string(), score: z.number(), size_kind: z.enum(SIZE_KINDS), alternate: z.string(), assembly: z.string().nullable() });
const piece = z.object({
  id: z.string(), region: z.enum(REGIONS), slot: z.enum(SLOTS), bbox: z.array(z.number()).length(4), area_frac: z.number(),
  colors: z.array(color), pattern: z.enum(["solid", "patterned"]), garment_types: z.array(garmentType),
  query: z.string(), alternate: z.string(), size_kind: z.enum(SIZE_KINDS), assembly: z.string().nullable(),
  embedding: z.array(z.number()).length(512), crop_b64: z.string(),
});
const analyzeSchema = z.object({
  person: z.object({ found: z.boolean(), bbox: z.array(z.number()).length(4).nullable(), confidence: z.number() }),
  pieces: z.array(piece), title: z.string(),
  timings_ms: z.record(z.string(), z.number()),
});
const matchResult = z.object({
  id: z.string(), garment_found: z.boolean(), foreground: z.enum(["segmenter", "grabcut", "threshold"]),
  embedding_similarity: z.number(), color_delta_e: z.number(), hist_similarity: z.number(), score: z.number(),
  verdict: z.enum(["match", "weak", "reject"]), reasons: z.array(z.enum(REASONS)),
  candidate_color: z.object({ name: z.string(), hex: z.string() }),
});
const matchSchema = z.object({ results: z.array(matchResult), timings_ms: z.object({ total: z.number() }) });

export type VisionPiece = z.infer<typeof piece>;
export type VisionAnalysis = z.infer<typeof analyzeSchema>;
export type MatchResult = z.infer<typeof matchResult>;
export type MatchReason = typeof REASONS[number];
type RetryReason = MatchReason | "no_candidates" | "weak_score";

export function visionMode() {
  const mode = process.env.SCREENSHOT_VISION ?? "opencv";
  if (mode !== "opencv" && mode !== "luna") throw new PreviewError(503, `SCREENSHOT_VISION must be opencv or luna, not ${mode}.`);
  return mode;
}

export function config() {
  const url = process.env.VISION_SERVICE_URL?.replace(/\/$/, "");
  const token = process.env.VISION_SERVICE_TOKEN;
  if (!url || !token) throw new PreviewError(503, "The OpenCV vision service is not configured (VISION_SERVICE_URL and VISION_SERVICE_TOKEN).");
  return { url, token };
}

let visionBuild: string | null = null;

/** Checks the service once per instance, so a missing service fails the upload with a 503 before streaming. */
export async function visionModel() {
  if (!visionBuild) {
    const { url } = config();
    const response = await fetch(`${url}/healthz`, { cache: "no-store", signal: AbortSignal.timeout(3_000) }).catch(() => null);
    const health = await response?.json().catch(() => null) as { ok?: boolean; opencv_version?: string; build?: string } | null;
    if (!response?.ok || !health?.ok) throw new PreviewError(503, "The OpenCV vision service is not reachable.");
    visionBuild = response.headers.get("x-opencv-build") ?? `${health.opencv_version};${health.build}`;
  }
  return `opencv-5:${visionBuild}`;
}

async function call<T>(path: string, body: object, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
  const { url, token } = config();
  const response = await fetch(`${url}${path}`, {
    method: "POST", cache: "no-store", signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) throw new Error(`Vision service ${path} failed (HTTP ${response.status} ${payload?.error?.code ?? ""}): ${payload?.error?.message ?? "no body"}`);
  return schema.parse(payload);
}

export const analyze = (image: Buffer, signal: AbortSignal) =>
  call("/v1/analyze", { image_b64: image.toString("base64"), max_pieces: 8 }, analyzeSchema, signal);

export const match = (p: VisionPiece, candidates: { id: string; image: Buffer }[], signal: AbortSignal) =>
  call("/v1/match", {
    piece: { region: p.region, colors: p.colors, embedding: p.embedding, garment_phrase: p.garment_types[0]?.phrase ?? p.query },
    candidates: candidates.map(c => ({ id: c.id, image_b64: c.image.toString("base64") })),
  }, matchSchema, signal);

const NAMES: Record<typeof REGIONS[number], string> = {
  hat: "Hat", upper_clothes: "Top", dress: "Dress", skirt: "Skirt", pants: "Pants", belt: "Belt", shoes: "Shoes", bag: "Bag", scarf: "Scarf", sunglasses: "Sunglasses",
};
const clip = (text: string, max: number) => text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
const pad = (text: string) => text.length >= 3 ? text : `${text} item`;

/** Maps analyze output onto the shopping list the rest of the pipeline already understands. */
export function analysisToLook(analysis: VisionAnalysis): ScreenshotLook {
  const pieces = analysis.pieces.slice(0, 8).map(p => {
    const phrase = p.garment_types[0]?.phrase;
    return {
      name: clip(phrase ? `${p.colors[0]?.name ?? ""} ${phrase}`.trim() : NAMES[p.region], 70),
      slot: p.slot, query: clip(pad(p.query), 90), alternate: clip(pad(p.alternate), 90),
      assembly: p.assembly ? clip(p.assembly, 140) : null, sizeKind: p.size_kind,
    };
  });
  const summary = clip(pieces.map(p => p.name.toLowerCase()).join(", "), 180);
  return { character: clip(analysis.title || "Screenshot look", 100), summary, pieces };
}

export type TraceStep = "perceive" | "search" | "score" | "decide" | "approve";
export interface TraceEntry { t_ms: number; piece: number | null; step: TraceStep; detail: Record<string, unknown> }

export type Decision =
  | { action: "accept"; best: MatchResult }
  | { action: "retry"; query: string; because: RetryReason }
  | { action: "approve"; best: MatchResult | null; because: string };

export const MAX_RETRIES = 2;
// A retry costs about 10 s of search, merchant reads and scoring; one started later loses the weak pick it replaced.
export const MIN_RETRY_BUDGET_MS = 10_000;

/**
 * The agent's rule table. Each retry changes exactly one thing about the query, so the trace
 * shows why the next search differs from the last one.
 */
export function decideNext(p: VisionPiece, results: MatchResult[], attempt: number, remainingMs: number, tried: Set<string>): Decision {
  const ranked = [...results].sort((a, b) => b.score - a.score);
  const best = ranked.find(r => r.verdict !== "reject") ?? null;
  if (best?.verdict === "match") return { action: "accept", best };
  if (attempt >= MAX_RETRIES || remainingMs < MIN_RETRY_BUDGET_MS) return { action: "approve", best, because: attempt >= MAX_RETRIES ? "retries_exhausted" : "budget_low" };

  const count = (reason: MatchReason) => results.filter(r => r.reasons.includes(reason)).length;
  const phrase = p.garment_types[0]?.phrase ?? p.query;
  const options: { query: string | undefined; because: RetryReason }[] = [];
  if (!results.length || count("no_garment") * 2 >= results.length) options.push({ query: p.alternate, because: results.length ? "no_garment" : "no_candidates" });
  if (count("color_mismatch") >= count("type_mismatch") && count("color_mismatch") > 0)
    options.push(...p.colors.slice(0, 2).map(c => ({ query: `${c.name} ${phrase}`, because: "color_mismatch" as const })));
  if (count("type_mismatch") > 0) options.push(...p.garment_types.slice(1).map(g => ({ query: `${p.colors[0]?.name ?? ""} ${g.phrase}`.trim(), because: "type_mismatch" as const })));
  options.push({ query: p.alternate, because: results.length ? "weak_score" : "no_candidates" });
  const next = options.find(o => o.query && !tried.has(o.query.toLowerCase()));
  return next ? { action: "retry", query: next.query!, because: next.because } : { action: "approve", best, because: "no_new_query" };
}
