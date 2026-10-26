/**
 * Agent-loop eval: POST each editorial fixture to /api/screenshot-costume (run the
 * Next server with SCREENSHOT_VISION=opencv), parse the NDJSON stream and its trace,
 * and report how each piece ended: first-try match, retry-recovered, needs approval,
 * or unmatched. Also writes a contact sheet for hand-labelling chosen products.
 *
 *   bun scripts/eval-agent.ts [--base http://localhost:3000] [--only slug,slug] [--rescore] [--concurrency 3]
 *
 * Raw events are cached in eval/out/agent-runs.json, so --rescore rebuilds the report
 * and contact sheet without calling the route again.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "eval", "out");
const RUNS = join(OUT, "agent-runs.json");

type Event = { t: string; ms?: number; [k: string]: unknown };
type Run = { slug: string; ok: boolean; status: number; error?: string; wall_ms: number; events: Event[] };
type Costume = { slug: string; image: string };
type Outcome = "first_try" | "retry_recovered" | "needs_approval" | "unmatched";
type Item = { title: string; image: string; productUrl: string; merchantName: string; priceCents: number };
type ScoreRow = { title: string; score: number; verdict: string; reasons?: string[]; embedding?: number; delta_e?: number; color?: { name: string; hex: string } };
type PieceResult = {
  slug: string; i: number; name: string; outcome: Outcome; attempts: number; retry_reasons: string[];
  approve_reason?: string; first_match_ms?: number; crop?: string; colors?: { name: string; hex: string }[];
  garment?: string; queries: string[]; item?: Item; score?: ScoreRow;
};

const { values: args } = parseArgs({
  options: {
    base: { type: "string", default: process.env.EVAL_BASE_URL ?? "http://localhost:3000" },
    only: { type: "string" },
    rescore: { type: "boolean", default: false },
    concurrency: { type: "string", default: "3" }, // the route rejects a 5th concurrent request with 429
  },
});

const truth = JSON.parse(readFileSync(join(ROOT, "eval", "ground-truth.json"), "utf8")) as { costumes: Costume[] };
const only = args.only?.split(",");
const costumes = truth.costumes.filter(c => !only || only.includes(c.slug));

// ---------- run ----------

async function runOne(c: Costume): Promise<Run> {
  const form = new FormData();
  form.append("photo", new Blob([readFileSync(join(ROOT, c.image))], { type: "image/jpeg" }), `${c.slug}.jpg`);
  const t0 = performance.now();
  const res = await fetch(`${args.base}/api/screenshot-costume`, { method: "POST", body: form });
  const events: Event[] = [];
  if (!res.ok || !res.body) {
    return { slug: c.slug, ok: false, status: res.status, error: (await res.text()).slice(0, 300), wall_ms: Math.round(performance.now() - t0), events };
  }
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) events.push({ ...JSON.parse(line), wall_ms: Math.round(performance.now() - t0) });
    }
  }
  if (buf.trim()) events.push(JSON.parse(buf));
  const err = events.find(e => e.t === "error");
  const done = events.some(e => e.t === "done");
  return { slug: c.slug, ok: done && !err, status: res.status, error: err ? String(err.text) : done ? undefined : "stream ended without done",
    wall_ms: Math.round(performance.now() - t0), events };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const k = next++;
      out[k] = await fn(items[k]);
      console.error(`${items.length - k - 1} left`);
    }
  }));
  return out;
}

// ---------- classify ----------

const at = (e: Event) => Number(e.ms ?? e.wall_ms ?? 0);

function classify(run: Run): PieceResult[] {
  const look = run.events.find(e => e.t === "look") as (Event & { pieces: { name: string }[]; vision?: { crop: string; colors: { name: string; hex: string }[]; garmentTypes: { phrase: string }[] }[] }) | undefined;
  if (!look) return [];
  const trace = run.events.filter(e => e.t === "trace") as (Event & { piece: number | null; step: string; detail: Record<string, unknown> })[];
  return look.pieces.map((p, i) => {
    const mine = trace.filter(e => e.piece === i);
    const decides = mine.filter(e => e.step === "decide").map(e => e.detail as { attempt: number; action: string; because: string });
    const accepted = run.events.find(e => e.t === "piece" && e.i === i) as (Event & { item: Item }) | undefined;
    const approval = run.events.find(e => e.t === "approval" && e.i === i) as (Event & { item: Item; because: string }) | undefined;
    const item = accepted?.item ?? approval?.item;
    const outcome: Outcome = accepted
      ? decides.some(d => d.action === "retry") ? "retry_recovered" : "first_try"
      : approval ? "needs_approval" : "unmatched";
    const scores = mine.filter(e => e.step === "score").flatMap(e => (e.detail as { results: ScoreRow[] }).results);
    const firstMatch = run.events.find(e => (e.t === "piece" || e.t === "approval") && e.i === i);
    return {
      slug: run.slug, i, name: p.name, outcome, attempts: Math.max(1, decides.length),
      retry_reasons: decides.filter(d => d.action === "retry").map(d => d.because),
      approve_reason: approval?.because,
      first_match_ms: firstMatch ? at(firstMatch) : undefined,
      crop: look.vision?.[i]?.crop, colors: look.vision?.[i]?.colors, garment: look.vision?.[i]?.garmentTypes[0]?.phrase,
      queries: mine.filter(e => e.step === "search").map(e => String((e.detail as { query: string }).query)),
      item, score: item ? scores.filter(s => s.title === item.title).sort((a, b) => b.score - a.score)[0] : undefined,
    };
  });
}

// ---------- report ----------

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

function report(runs: Run[], pieces: PieceResult[]): string {
  const count = (o: Outcome) => pieces.filter(p => p.outcome === o).length;
  const retried = pieces.filter(p => p.retry_reasons.length);
  const firstMatch = runs.map(r => Math.min(...r.events.filter(e => e.t === "piece" || e.t === "approval").map(at))).filter(Number.isFinite);
  const done = runs.map(r => r.events.find(e => e.t === "done")).filter(Boolean).map(e => at(e!));
  const timedOut = runs.filter(r => (r.events.find(e => e.t === "done") as { timedOut?: boolean } | undefined)?.timedOut).length;
  const reasons = new Map<string, number>();
  for (const p of pieces) for (const r of [...p.retry_reasons, ...(p.approve_reason ? [`approve:${p.approve_reason}`] : [])]) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  const n = pieces.length;
  const lines = [
    "# Agent loop eval (SCREENSHOT_VISION=opencv)",
    "",
    `Generated ${new Date().toISOString()} by \`bun scripts/eval-agent.ts\`. ${runs.length} images, ${runs.filter(r => r.ok).length} completed, ${n} pieces.`,
    "",
    "| Outcome | Pieces | Share |",
    "|---|---:|---:|",
    `| Matched on first try | ${count("first_try")} | ${pct(count("first_try"), n)} |`,
    `| Matched after retry | ${count("retry_recovered")} | ${pct(count("retry_recovered"), n)} |`,
    `| Needs shopper approval | ${count("needs_approval")} | ${pct(count("needs_approval"), n)} |`,
    `| Unmatched | ${count("unmatched")} | ${pct(count("unmatched"), n)} |`,
    "",
    `Retry recovery rate: ${pct(count("retry_recovered"), retried.length)} of the ${retried.length} pieces the agent retried ended in an accepted match.`,
    "",
    "| Latency | p50 | p95 |",
    "|---|---:|---:|",
    `| Time to first match (ms) | ${quantile(firstMatch, 0.5)} | ${quantile(firstMatch, 0.95)} |`,
    `| Time to done (ms) | ${quantile(done, 0.5)} | ${quantile(done, 0.95)} |`,
    "",
    `${timedOut} of ${runs.length} runs hit the 30 s search budget.`,
    "",
    "## Retry and approval reasons",
    "",
    "| Reason | Count |",
    "|---|---:|",
    ...[...reasons].sort((a, b) => b[1] - a[1]).map(([r, k]) => `| ${r} | ${k} |`),
    "",
    "## Failed runs",
    "",
    ...(runs.some(r => !r.ok) ? runs.filter(r => !r.ok).map(r => `- ${r.slug}: HTTP ${r.status}, ${r.error}`) : ["None."]),
    "",
    "## Per image",
    "",
    "| Image | First try | Retry | Approval | Unmatched | Done (ms) |",
    "|---|---:|---:|---:|---:|---:|",
    ...runs.map(r => {
      const ps = pieces.filter(p => p.slug === r.slug);
      const k = (o: Outcome) => ps.filter(p => p.outcome === o).length;
      const d = r.events.find(e => e.t === "done");
      return `| ${r.slug} | ${k("first_try")} | ${k("retry_recovered")} | ${k("needs_approval")} | ${k("unmatched")} | ${d ? at(d) : "-"} |`;
    }),
    "",
  ];
  return lines.join("\n");
}

function contactSheet(pieces: PieceResult[]): string {
  const rows = pieces.filter(p => p.item).map(p => {
    const key = `${p.slug}#${p.i}`;
    const s = p.score;
    const swatches = (p.colors ?? []).map(c => `<span class="sw" style="background:${c.hex}" title="${esc(c.name)}"></span>${esc(c.name)}`).join(" ");
    return `<tr data-key="${esc(key)}">
<td>${p.crop ? `<img src="${p.crop}">` : ""}<div class="meta">${esc(p.slug)} · ${esc(p.name)}<br>${esc(p.garment ?? "")}<br>${swatches}</div></td>
<td><img src="${esc(p.item!.image)}" loading="lazy"><div class="meta"><a href="${esc(p.item!.productUrl)}" target="_blank" rel="noreferrer">${esc(p.item!.title)}</a><br>${esc(p.item!.merchantName)}</div></td>
<td class="meta">${p.outcome}<br>score ${s ? s.score.toFixed(3) : "?"} (${s?.verdict ?? "?"})<br>emb ${s?.embedding?.toFixed(3) ?? "?"} · ΔE ${s?.delta_e?.toFixed(1) ?? "?"}<br>cand ${esc(s?.color?.name ?? "?")}<br>${esc((s?.reasons ?? []).join(", "))}<br>queries: ${esc(p.queries.join(" → "))}</td>
<td><label><input type="radio" name="${esc(key)}" value="accept"> accept</label><br><label><input type="radio" name="${esc(key)}" value="reject"> reject</label></td>
</tr>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><title>Match labels</title><style>
body{font:14px system-ui;margin:16px;background:#fff;color:#111}table{border-collapse:collapse}td{border-top:1px solid #ddd;padding:8px;vertical-align:top}
img{width:180px;height:180px;object-fit:contain;background:#f4f4f4}.meta{font-size:12px;color:#444;max-width:260px}.sw{display:inline-block;width:10px;height:10px;border:1px solid #999;margin:0 2px}
#bar{position:sticky;top:0;background:#fff;padding:8px 0;border-bottom:1px solid #ddd}
</style></head><body>
<div id="bar"><b>Is the chosen product a reasonable buy for this piece?</b> <span id="n"></span> <button id="save">Download match-labels.json</button></div>
<table>${rows.join("\n")}</table>
<script>
const radios=[...document.querySelectorAll('input[type=radio]')];
const count=()=>{const k=new Set(radios.filter(r=>r.checked).map(r=>r.name));document.getElementById('n').textContent=k.size+' / ${rows.length} labelled'};
radios.forEach(r=>r.addEventListener('change',count));count();
document.getElementById('save').onclick=()=>{const labels={};radios.filter(r=>r.checked).forEach(r=>labels[r.name]=r.value);
const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({labels},null,2)],{type:'application/json'}));a.download='match-labels.json';a.click()};
</script></body></html>`;
}

/** Acceptance rate from eval/match-labels.json ({labels: {"slug#i": "accept"|"reject"}}), if Oscar has labelled. */
function acceptance(pieces: PieceResult[]): string {
  const path = join(ROOT, "eval", "match-labels.json");
  if (!existsSync(path)) return "";
  const labels = (JSON.parse(readFileSync(path, "utf8")) as { labels: Record<string, string> }).labels;
  const by = (o: Outcome | null) => {
    const ps = pieces.filter(p => labels[`${p.slug}#${p.i}`] && (!o || p.outcome === o));
    const ok = ps.filter(p => labels[`${p.slug}#${p.i}`] === "accept").length;
    return `${ok} / ${ps.length} (${pct(ok, ps.length)})`;
  };
  return ["## Human acceptance of chosen products", "", "| Outcome | Accepted |", "|---|---:|",
    `| All labelled | ${by(null)} |`, `| First try | ${by("first_try")} |`, `| After retry | ${by("retry_recovered")} |`, `| Needs approval | ${by("needs_approval")} |`, ""].join("\n");
}

// ---------- main ----------

mkdirSync(OUT, { recursive: true });
let runs: Run[];
if (args.rescore) {
  runs = (JSON.parse(readFileSync(RUNS, "utf8")) as Run[]).filter(r => !only || only.includes(r.slug));
} else {
  runs = await pool(costumes, Number(args.concurrency), runOne);
  const cached = existsSync(RUNS) ? (JSON.parse(readFileSync(RUNS, "utf8")) as Run[]).filter(r => !runs.some(n => n.slug === r.slug)) : [];
  writeFileSync(RUNS, JSON.stringify([...cached, ...runs]));
  if (only) runs = [...cached, ...runs];
}
runs.sort((a, b) => a.slug.localeCompare(b.slug));
const pieces = runs.flatMap(classify);
writeFileSync(join(OUT, "agent.md"), report(runs, pieces) + "\n" + acceptance(pieces));
writeFileSync(join(OUT, "contact-sheet.html"), contactSheet(pieces));
console.log(readFileSync(join(OUT, "agent.md"), "utf8").split("\n").slice(0, 22).join("\n"));
