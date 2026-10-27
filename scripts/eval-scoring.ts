/**
 * Scoring sweep: replays every candidate the agent scored (trace "score" steps in
 * eval/out/agent-runs.json) under other weights and thresholds for vision/app/scoring.py,
 * and reports match precision and recall before and after.
 *
 *   bun scripts/eval-scoring.ts [--runs eval/out/agent-runs.json]
 *
 * The trace carries the embedding similarity, ΔE and final score but not the histogram
 * similarity, so hist is backed out from the score with the current weights.
 *
 * Labels: eval/match-labels.json (Oscar's contact-sheet labels) wins where it covers the
 * agent's chosen product. Every other candidate gets a stand-in label from its product
 * title: relevant when the title's garment is in the piece's garment class and the title
 * names no color from a different family than the piece's measured color.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { colorFamily, colorFrom, garmentSimilarity } from "./eval-match";

const ROOT = join(import.meta.dir, "..");
const { values: args } = parseArgs({ options: { runs: { type: "string", default: join(ROOT, "eval", "out", "agent-runs.json") } } });

// Current constants in vision/app/scoring.py. Keep in sync by hand; this script never edits it.
const CURRENT: Config = { wEmb: 0.55, wColor: 0.30, wHist: 0.15, matchMin: 0.60, typeEmb: 0.68, colorDe: 25 };
const EMB_FLOOR = 0.55, EMB_CEIL = 0.90, DELTA_E_MAX = 40;

type Config = { wEmb: number; wColor: number; wHist: number; matchMin: number; typeEmb: number; colorDe: number };
type Row = {
  key: string; title: string; piece: string; pieceColor: string | null;
  emb: number; de: number; hist: number; noGarment: boolean; chosen: boolean; relevant: boolean; source: "oscar" | "title";
};

const clip = (x: number) => Math.max(0, Math.min(1, x));
const embN = (e: number) => clip((e - EMB_FLOOR) / (EMB_CEIL - EMB_FLOOR));
const colorN = (de: number) => 1 - clip(de / DELTA_E_MAX);

function verdict(r: Row, c: Config): "match" | "other" {
  if (r.noGarment) return "other";
  const s = c.wEmb * embN(r.emb) + c.wColor * colorN(r.de) + c.wHist * r.hist;
  return s >= c.matchMin && r.de <= c.colorDe && r.emb >= c.typeEmb ? "match" : "other";
}

// ---------- collect scored candidates ----------

const runs = JSON.parse(readFileSync(args.runs!, "utf8")) as { slug: string; events: any[] }[];
const labelsPath = join(ROOT, "eval", "match-labels.json");
const oscar: Record<string, string> = existsSync(labelsPath) ? JSON.parse(readFileSync(labelsPath, "utf8")).labels ?? {} : {};

const rows: Row[] = [];
for (const run of runs) {
  const look = run.events.find(e => e.t === "look");
  const perceive = run.events.find(e => e.t === "trace" && e.step === "perceive");
  if (!look) continue;
  const chosen = new Map<number, string>();
  for (const e of run.events) if (e.t === "candidate" || e.t === "piece") chosen.set(e.i, e.item?.title ?? e.match?.title ?? "");
  for (const e of run.events) {
    if (e.t !== "trace" || e.step !== "score") continue;
    const i: number = e.piece;
    const piece = look.pieces[i]?.name ?? "";
    const pieceColor = perceive?.detail?.pieces?.[i]?.colors?.[0]?.name ?? colorFrom(piece);
    for (const res of e.detail?.results ?? []) {
      const noGarment = (res.reasons ?? []).includes("no_garment");
      const color = noGarment ? 0 : colorN(res.delta_e);
      const hist = noGarment ? 0 : clip((res.score - CURRENT.wEmb * embN(res.embedding) - CURRENT.wColor * color) / CURRENT.wHist);
      const key = `${run.slug}#${i}`;
      const isChosen = !!chosen.get(i) && sameProduct(chosen.get(i)!, res.title);
      const titleColor = colorFamily(colorFrom(res.title));
      const titleLabel = garmentSimilarity(res.title, piece) >= 0.75 && (!titleColor || titleColor === colorFamily(pieceColor));
      const fromOscar = isChosen && oscar[key];
      rows.push({
        key, title: res.title, piece, pieceColor, emb: res.embedding, de: res.delta_e, hist, noGarment, chosen: isChosen,
        relevant: fromOscar ? oscar[key] === "accept" : titleLabel, source: fromOscar ? "oscar" : "title",
      });
    }
  }
}

/** The route rewrites titles slightly between the score trace and the candidate event. */
function sameProduct(a: string, b: string) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const [x, y] = [norm(a), norm(b)];
  return x.includes(y) || y.includes(x);
}

// ---------- sweep ----------

function evaluate(c: Config) {
  let tp = 0, fp = 0, fn = 0;
  for (const r of rows) {
    const m = verdict(r, c) === "match";
    if (m && r.relevant) tp++;
    else if (m) fp++;
    else if (r.relevant) fn++;
  }
  const p = tp + fp ? tp / (tp + fp) : 0, rc = tp + fn ? tp / (tp + fn) : 0;
  return { tp, fp, fn, precision: p, recall: rc, f1: p + rc ? 2 * p * rc / (p + rc) : 0 };
}

const range = (a: number, b: number, step: number) => Array.from({ length: Math.round((b - a) / step) + 1 }, (_, k) => +(a + k * step).toFixed(3));
const results: { c: Config; m: ReturnType<typeof evaluate> }[] = [];
for (const wEmb of range(0.35, 0.8, 0.05))
  for (const wColor of range(0.1, 0.5, 0.05)) {
    const wHist = +(1 - wEmb - wColor).toFixed(3);
    if (wHist < 0) continue;
    for (const matchMin of range(0.45, 0.7, 0.025))
      for (const typeEmb of range(0.58, 0.72, 0.02))
        for (const colorDe of range(15, 40, 5)) {
          const c = { wEmb, wColor, wHist, matchMin, typeEmb, colorDe };
          results.push({ c, m: evaluate(c) });
        }
  }

// Many configs tie on a few hundred rows, so among those within 0.02 F1 of the best,
// prefer the one closest to the current constants: the smallest change that gets the gain.
const distance = (c: Config) =>
  Math.abs(c.wEmb - CURRENT.wEmb) + Math.abs(c.wColor - CURRENT.wColor) + Math.abs(c.matchMin - CURRENT.matchMin)
  + Math.abs(c.typeEmb - CURRENT.typeEmb) + Math.abs(c.colorDe - CURRENT.colorDe) / 40;
const bestF1 = Math.max(...results.map(r => r.m.f1));
const proposal = results.filter(r => r.m.f1 >= bestF1 - 0.02).sort((a, b) => b.m.precision - a.m.precision || distance(a.c) - distance(b.c))[0];
const best = results.sort((a, b) => b.m.f1 - a.m.f1 || distance(a.c) - distance(b.c))[0];

// One-at-a-time sensitivity from the current constants, so each knob's effect is visible.
const single = (k: keyof Config, vals: number[]) => vals.map(v => ({ v, m: evaluate({ ...CURRENT, [k]: v }) }));

// ---------- report ----------

const before = evaluate(CURRENT);
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const line = (name: string, c: Config, m: ReturnType<typeof evaluate>) =>
  `| ${name} | ${c.wEmb} / ${c.wColor} / ${c.wHist} | ${c.matchMin} | ${c.typeEmb} | ${c.colorDe} | ${pct(m.precision)} | ${pct(m.recall)} | ${m.f1.toFixed(3)} | ${m.tp}/${m.fp}/${m.fn} |`;
const nRel = rows.filter(r => r.relevant).length, nOscar = rows.filter(r => r.source === "oscar").length;

const md = `# Scoring sweep for vision/app/scoring.py

Generated ${new Date().toISOString()} by \`bun scripts/eval-scoring.ts\` from \`${args.runs!.replace(ROOT + "/", "")}\`. This is a proposal only; scoring.py is unchanged.

${rows.length} scored candidates across ${new Set(rows.map(r => r.key)).size} pieces, ${nRel} labelled relevant. ${nOscar} labels come from Oscar's contact sheet (\`eval/match-labels.json\`); the other ${rows.length - nOscar} are stand-in labels from the product title (same garment class as the piece, and no title color from a different family). Title labels are noisy, so treat the numbers as directional until the contact sheet is labelled and this is rerun.

A "match" here is the service's \`match\` verdict: score ≥ MATCH_MIN, ΔE ≤ COLOR_MISMATCH_DELTA_E and embedding ≥ TYPE_MISMATCH_EMBEDDING. Precision is relevant matches over all matches; recall is relevant matches over all relevant candidates.

| config | W emb / color / hist | MATCH_MIN | TYPE_MISMATCH_EMBEDDING | COLOR_MISMATCH_DELTA_E | precision | recall | F1 | tp/fp/fn |
|---|---|---|---|---|---|---|---|---|
${line("current", CURRENT, before)}
${line("proposed", proposal.c, proposal.m)}
${line("best F1", best.c, best.m)}

"Proposed" is the highest-precision config within 0.02 F1 of the best, nearest the current constants on ties. ${results.length} configs searched.

## One knob at a time (others at current values)

| TYPE_MISMATCH_EMBEDDING | precision | recall | F1 |
|---|---|---|---|
${single("typeEmb", range(0.58, 0.72, 0.02)).map(({ v, m }) => `| ${v} | ${pct(m.precision)} | ${pct(m.recall)} | ${m.f1.toFixed(3)} |`).join("\n")}

| MATCH_MIN | precision | recall | F1 |
|---|---|---|---|
${single("matchMin", range(0.45, 0.7, 0.05)).map(({ v, m }) => `| ${v} | ${pct(m.precision)} | ${pct(m.recall)} | ${m.f1.toFixed(3)} |`).join("\n")}

| COLOR_MISMATCH_DELTA_E | precision | recall | F1 |
|---|---|---|---|
${single("colorDe", range(15, 40, 5)).map(({ v, m }) => `| ${v} | ${pct(m.precision)} | ${pct(m.recall)} | ${m.f1.toFixed(3)} |`).join("\n")}

## Embedding similarity by label

| label | n | p25 | median | p75 |
|---|---|---|---|---|
${(["relevant", "not relevant"] as const).map(l => {
  const xs = rows.filter(r => !r.noGarment && r.relevant === (l === "relevant")).map(r => r.emb).sort((a, b) => a - b);
  const q = (p: number) => xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))].toFixed(3) : "n/a";
  return `| ${l} | ${xs.length} | ${q(0.25)} | ${q(0.5)} | ${q(0.75)} |`;
}).join("\n")}
`;

writeFileSync(join(ROOT, "eval", "out", "scoring.md"), md);
console.log(md);
