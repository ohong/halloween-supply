/**
 * Decomposition eval: OpenCV service (/v1/analyze) vs luna (decomposeScreenshot)
 * on the 25 catalog editorial images, scored against eval/ground-truth.json.
 *
 *   bun scripts/eval-decompose.ts --pipeline opencv|luna|both [--only slug,slug] [--rescore]
 *
 * Raw predictions are cached in eval/out/decompose-<pipeline>.json, so --rescore
 * re-scores without calling either pipeline again.
 *
 * Env: VISION_SERVICE_URL, VISION_SERVICE_TOKEN (opencv); OPENAI_API_KEY (luna);
 * LUNA_USD_PER_M_INPUT, LUNA_USD_PER_M_OUTPUT (luna cost); OPENCV_USD_PER_HOUR (opencv cost).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { synonyms, colorFrom, garmentSimilarity } from "./eval-match";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "eval", "out");
const CROPS = join(OUT, "crops");

type Slot = "head" | "top" | "outer" | "bottom" | "feet" | "accessory";
type Truth = { id: string; slot: Slot; alt_slots?: Slot[]; garment: string; color: string };
type Costume = { slug: string; image: string; components: Truth[] };
type Prediction = { id: string; slot: Slot; phrase: string; color: string | null; query: string; crop?: string };
type Run = {
  slug: string; ok: boolean; error?: string; latency_ms: number; pieces: Prediction[];
  person_found?: boolean; server_ms?: number; usage?: { input_tokens: number; output_tokens: number };
};
type Pipeline = "opencv" | "luna";

const { values: args } = parseArgs({
  options: {
    pipeline: { type: "string", default: "both" },
    only: { type: "string" },
    rescore: { type: "boolean", default: false },
    concurrency: { type: "string", default: "4" },
  },
});

const truth = JSON.parse(readFileSync(join(ROOT, "eval", "ground-truth.json"), "utf8")) as { costumes: Costume[] };
const only = args.only?.split(",");
const costumes = truth.costumes.filter(c => !only || only.includes(c.slug));
const pipelines: Pipeline[] = args.pipeline === "both" ? ["opencv", "luna"] : [args.pipeline as Pipeline];

// ---------- matching ----------

const slotOk = (pred: Slot, gt: Truth, strict: boolean) => {
  const allowed = [gt.slot, ...(gt.alt_slots ?? [])];
  return strict ? allowed.includes(pred) : allowed.some(s => synonyms.slot_groups[s].includes(pred));
};
const colorOk = (pred: string | null, gt: string) => !!pred && (synonyms.color_families[gt] ?? [gt]).includes(pred.toLowerCase());
type Pair = { pred: Prediction; gt: Truth; sim: number; slotExact: boolean; colorOk: boolean };
function matchCostume(preds: Prediction[], gts: Truth[]) {
  const candidates: Pair[] = [];
  for (const pred of preds) for (const gt of gts) {
    if (!slotOk(pred.slot, gt, false)) continue;
    const sim = garmentSimilarity(pred.phrase, gt.garment);
    if (sim < 0.5) continue;
    candidates.push({ pred, gt, sim, slotExact: slotOk(pred.slot, gt, true), colorOk: colorOk(pred.color, gt.color) });
  }
  // Greedy one-to-one: best garment similarity first, exact slot and color break ties.
  candidates.sort((x, y) => y.sim - x.sim || +y.slotExact - +x.slotExact || +y.colorOk - +x.colorOk);
  const pairs: Pair[] = [], usedP = new Set<string>(), usedG = new Set<string>();
  for (const c of candidates) {
    if (usedP.has(c.pred.id) || usedG.has(c.gt.id)) continue;
    pairs.push(c); usedP.add(c.pred.id); usedG.add(c.gt.id);
  }
  return {
    pairs,
    missed: gts.filter(g => !usedG.has(g.id)),
    extra: preds.filter(p => !usedP.has(p.id)),
  };
}

// ---------- pipelines ----------

const image = (c: Costume) => readFileSync(join(ROOT, c.image));

async function runOpencv(c: Costume): Promise<Run> {
  const url = process.env.VISION_SERVICE_URL ?? "http://localhost:8080";
  const started = performance.now();
  const response = await fetch(`${url}/v1/analyze`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.VISION_SERVICE_TOKEN ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify({ image_b64: image(c).toString("base64"), max_pieces: 8 }),
    signal: AbortSignal.timeout(60_000),
  });
  const latency_ms = performance.now() - started;
  if (!response.ok) return { slug: c.slug, ok: false, error: `HTTP ${response.status} ${await response.text()}`, latency_ms, pieces: [] };
  const body = await response.json() as {
    person: { found: boolean };
    pieces: { id: string; slot: Slot; region: string; colors: { name: string }[]; garment_types: { phrase: string }[]; query: string; crop_b64?: string }[];
    timings_ms: { total: number };
  };
  mkdirSync(CROPS, { recursive: true });
  return {
    slug: c.slug, ok: true, latency_ms, person_found: body.person.found, server_ms: body.timings_ms.total,
    pieces: body.pieces.map(p => {
      const crop = p.crop_b64 ? `crops/${c.slug}-${p.id}.jpg` : undefined;
      if (crop) writeFileSync(join(OUT, crop), Buffer.from(p.crop_b64!, "base64"));
      return { id: p.id, slot: p.slot, phrase: p.garment_types[0]?.phrase ?? p.region, color: p.colors[0]?.name ?? null, query: p.query, crop };
    }),
  };
}

// decomposeScreenshot does not return token usage, so read it off the OpenAI response per call.
const usageScope = new AsyncLocalStorage<{ input_tokens: number; output_tokens: number }>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const response = await realFetch(input, init);
  const scope = usageScope.getStore();
  if (scope && String(input).includes("api.openai.com")) {
    const usage = (await response.clone().json().catch(() => ({})) as { usage?: { input_tokens: number; output_tokens: number } }).usage;
    if (usage) { scope.input_tokens += usage.input_tokens; scope.output_tokens += usage.output_tokens; }
  }
  return response;
}) as typeof fetch;

async function runLuna(c: Costume): Promise<Run> {
  const { decomposeScreenshot } = await import("../lib/sourcing/screenshot-vision");
  const usage = { input_tokens: 0, output_tokens: 0 };
  const started = performance.now();
  try {
    const look = await usageScope.run(usage, () => decomposeScreenshot(image(c), AbortSignal.timeout(90_000)));
    return {
      slug: c.slug, ok: true, latency_ms: performance.now() - started, usage,
      pieces: look.pieces.map((p, i) => ({ id: `p${i}`, slot: p.slot, phrase: p.name, color: colorFrom(`${p.query} ${p.name}`), query: p.query })),
    };
  } catch (error) {
    return { slug: c.slug, ok: false, error: String(error), latency_ms: performance.now() - started, pieces: [], usage };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); process.stderr.write("."); }
  }));
  process.stderr.write("\n");
  return out;
}

// ---------- report ----------

const pct = (n: number, d: number) => d ? `${(100 * n / d).toFixed(1)}%` : "n/a";
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

function score(runs: Run[]) {
  const perCostume = costumes.map(c => {
    const run = runs.find(r => r.slug === c.slug)!;
    const m = matchCostume(run.pieces, c.components);
    return { c, run, ...m };
  });
  const sum = (f: (x: typeof perCostume[number]) => number) => perCostume.reduce((a, x) => a + f(x), 0);
  const matched = sum(x => x.pairs.length);
  return {
    perCostume,
    predicted: sum(x => x.run.pieces.length),
    truth: sum(x => x.c.components.length),
    matched,
    slotExact: sum(x => x.pairs.filter(p => p.slotExact).length),
    colorOk: sum(x => x.pairs.filter(p => p.colorOk).length),
    failures: runs.filter(r => !r.ok).length,
    latencies: runs.filter(r => r.ok).map(r => r.latency_ms),
    server: runs.filter(r => r.server_ms != null).map(r => r.server_ms!),
    usage: runs.reduce((a, r) => ({ input_tokens: a.input_tokens + (r.usage?.input_tokens ?? 0), output_tokens: a.output_tokens + (r.usage?.output_tokens ?? 0) }), { input_tokens: 0, output_tokens: 0 }),
  };
}

function costPerImage(p: Pipeline, s: ReturnType<typeof score>): string {
  if (p === "luna") {
    const i = Number(process.env.LUNA_USD_PER_M_INPUT), o = Number(process.env.LUNA_USD_PER_M_OUTPUT);
    const n = s.latencies.length || 1;
    const tokens = `${Math.round(s.usage.input_tokens / n)} in / ${Math.round(s.usage.output_tokens / n)} out tokens`;
    if (!i || !o) return `${tokens} (set LUNA_USD_PER_M_INPUT/OUTPUT for $)`;
    return `$${((s.usage.input_tokens * i + s.usage.output_tokens * o) / 1e6 / n).toFixed(5)} (${tokens})`;
  }
  const hourly = Number(process.env.OPENCV_USD_PER_HOUR);
  const mean = s.server.reduce((a, b) => a + b, 0) / (s.server.length || 1);
  if (!hourly || !s.server.length) return `server ${mean.toFixed(0)} ms/image (set OPENCV_USD_PER_HOUR for $)`;
  return `$${(hourly / 3600 * mean / 1000).toFixed(6)} (${hourly} $/h, ${mean.toFixed(0)} ms/image sequential, one request at a time)`;
}

function report(results: Partial<Record<Pipeline, ReturnType<typeof score>>>) {
  const ps = Object.keys(results) as Pipeline[];
  const lines: string[] = [
    "# Decomposition eval: OpenCV service vs luna",
    "",
    `Generated ${new Date().toISOString()} by \`bun scripts/eval-decompose.ts\`. ${costumes.length} catalog editorial images, ${costumes.reduce((a, c) => a + c.components.length, 0)} ground-truth components drafted from the catalog (see eval/README.md for limitations).`,
    "",
    "A prediction matches a ground-truth component when its slot is in the same slot group (top and outer are interchangeable) and its garment phrase has similarity ≥ 0.5 (same head noun = 1, same garment class = 0.75, compatible class = 0.5). Slot accuracy counts exact slot (or a listed alternate) among matched pairs. Color accuracy counts a predicted color name in the ground-truth color family among matched pairs.",
    "",
    `| metric | ${ps.join(" | ")} |`,
    `|---|${ps.map(() => "---").join("|")}|`,
  ];
  const row = (name: string, f: (s: ReturnType<typeof score>, p: Pipeline) => string) => lines.push(`| ${name} | ${ps.map(p => f(results[p]!, p)).join(" | ")} |`);
  row("precision", s => pct(s.matched, s.predicted));
  row("recall", s => pct(s.matched, s.truth));
  row("slot accuracy (matched)", s => pct(s.slotExact, s.matched));
  row("color-name accuracy (matched)", s => pct(s.colorOk, s.matched));
  row("pieces predicted / truth", s => `${s.predicted} / ${s.truth}`);
  row("failed requests", s => `${s.failures}`);
  row("latency p50 / p95 (client wall)", s => `${quantile(s.latencies, 0.5).toFixed(0)} / ${quantile(s.latencies, 0.95).toFixed(0)} ms`);
  row("server time p50 (opencv timings_ms.total)", s => s.server.length ? `${quantile(s.server, 0.5).toFixed(0)} ms` : "n/a");
  row("cost per image", (s, p) => costPerImage(p, s));
  lines.push("", "## Per costume (recall · precision · color)", "", `| costume | ${ps.join(" | ")} |`, `|---|${ps.map(() => "---").join("|")}|`);
  for (const c of costumes) {
    lines.push(`| ${c.slug} | ${ps.map(p => {
      const x = results[p]!.perCostume.find(y => y.c.slug === c.slug)!;
      if (!x.run.ok) return `error`;
      return `${x.pairs.length}/${c.components.length} · ${x.pairs.length}/${x.run.pieces.length} · ${x.pairs.filter(q => q.colorOk).length}/${x.pairs.length}`;
    }).join(" | ")} |`);
  }
  lines.push("", "## Details", "");
  for (const p of ps) {
    lines.push(`### ${p}`, "");
    for (const x of results[p]!.perCostume) {
      lines.push(`**${x.c.slug}**${x.run.person_found === false ? " (person.found = false)" : ""}${x.run.error ? ` error: ${x.run.error.slice(0, 160)}` : ""}`, "");
      for (const q of x.pairs) lines.push(`- ✓ ${q.gt.id}: "${q.pred.phrase}" (${q.pred.slot}, ${q.pred.color ?? "no color"})${q.slotExact ? "" : " · slot differs"}${q.colorOk ? "" : ` · color ≠ ${q.gt.color}`}`);
      for (const g of x.missed) lines.push(`- ✗ missed ${g.id}: ${g.color} ${g.garment} (${g.slot})`);
      for (const e of x.extra) lines.push(`- + extra "${e.phrase}" (${e.slot}, ${e.color ?? "no color"})${e.crop ? ` [crop](${e.crop})` : ""}`);
      lines.push("");
    }
  }
  writeFileSync(join(OUT, "decompose.md"), lines.join("\n"));
}

mkdirSync(OUT, { recursive: true });
const results: Partial<Record<Pipeline, ReturnType<typeof score>>> = {};
for (const p of pipelines) {
  const cache = join(OUT, `decompose-${p}.json`);
  let runs: Run[];
  if (args.rescore && existsSync(cache)) {
    runs = JSON.parse(readFileSync(cache, "utf8"));
  } else {
    console.error(`${p}: ${costumes.length} images`);
    // The opencv service is measured one request at a time so latency means per-image work.
    runs = await pool(costumes, p === "opencv" ? 1 : Number(args.concurrency), p === "opencv" ? runOpencv : runLuna);
    writeFileSync(cache, JSON.stringify(runs, null, 2));
  }
  results[p] = score(runs);
  const s = results[p]!;
  console.log(`${p}: precision ${pct(s.matched, s.predicted)} recall ${pct(s.matched, s.truth)} slot ${pct(s.slotExact, s.matched)} color ${pct(s.colorOk, s.matched)} failures ${s.failures}`);
}
// Keep both pipelines in the report when only one was re-run.
for (const p of ["opencv", "luna"] as Pipeline[]) {
  const cache = join(OUT, `decompose-${p}.json`);
  if (!results[p] && existsSync(cache)) results[p] = score(JSON.parse(readFileSync(cache, "utf8")));
}
report(results);
console.log("wrote eval/out/decompose.md");
