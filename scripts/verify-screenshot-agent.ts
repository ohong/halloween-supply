// Real HTTP, real OpenCV vision service, real web search. Needs SCREENSHOT_VISION=opencv on the server.
// Example: bun scripts/verify-screenshot-agent.ts http://localhost:3000 --require-retry
// Each run's agent trace is saved to eval/traces/<slug>-<stamp>.json.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const base = process.argv.find(arg => /^https?:/.test(arg)) ?? "http://localhost:3000";
const samples = process.env.SCREENSHOT_SAMPLES?.split(",") ?? ["clockwork-aviator", "cosmic-cowboy", "coral-mermaid", "velvet-vampire"];
const requireRetry = process.argv.includes("--require-retry");
const traceDir = path.join(process.cwd(), "eval/traces");
await mkdir(traceDir, { recursive: true });

type Detail = { attempt: number; action?: string; because?: string; results?: { score: number }[] } & Record<string, unknown>;
type Trace = { t: "trace"; t_ms: number; piece: number | null; step: string; detail: Detail };
type Event = { t: string; ms: number; i?: number; found?: number; pieces?: { name: string }[]; vision?: unknown[]; because?: string } & Partial<Omit<Trace, "t">>;

let improvedRetries = 0;
for (const sample of samples) {
  // A sample is a costume slug from public/costumes, or a path to any PNG.
  const file = sample.endsWith(".png") ? path.resolve(sample) : path.join(process.cwd(), "public/costumes", `${sample}.png`);
  const slug = path.basename(file, ".png");
  const form = new FormData();
  form.set("photo", new File([await readFile(file)], `${slug}.png`, { type: "image/png" }));
  const start = performance.now();
  const response = await fetch(`${base}/api/screenshot-costume`, { method: "POST", body: form, signal: AbortSignal.timeout(45_000) });
  assert.equal(response.status, 200, `${slug}: HTTP ${response.status} ${await response.clone().text()}`);
  const model = response.headers.get("x-vision-model") ?? "";
  assert.match(model, /^opencv-/, `${slug}: the route used ${model}, not the OpenCV service`);
  const events: Event[] = (await response.text()).split("\n").filter(Boolean).map(line => JSON.parse(line));
  const elapsedMs = Math.round(performance.now() - start);

  const look = events.find(e => e.t === "look");
  const trace = events.filter((e): e is Event & Trace => e.t === "trace");
  const done = events.find(e => e.t === "done");
  // A retry "improves" when it was made for a color or type mismatch and a later attempt outscores the attempt it replaced.
  const retries = trace.filter(e => e.step === "decide" && e.detail.action === "retry");
  const bestAt = (piece: number | null, attempt: number) => Math.max(0, ...trace.filter(e => e.piece === piece && e.step === "score" && e.detail.attempt === attempt)
    .flatMap(e => (e.detail.results ?? []).map(r => r.score)));
  const improved = [...new Set(retries.filter(e => /^(color|type)_mismatch$/.test(e.detail.because ?? "")).filter(e => {
    const before = bestAt(e.piece, e.detail.attempt);
    return before > 0 && trace.some(s => s.piece === e.piece && s.step === "score" && s.detail.attempt > e.detail.attempt && bestAt(e.piece, s.detail.attempt) > before);
  }).map(e => e.piece))];
  improvedRetries += improved.length;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tracePath = path.join(traceDir, `${slug}-${stamp}.json`);
  await writeFile(tracePath, JSON.stringify({ slug, base, model, elapsedMs, done, pieces: look?.pieces?.map(p => p.name),
    approvals: events.filter(e => e.t === "approval").map(e => ({ i: e.i, because: e.because })),
    retries: retries.map(e => ({ piece: e.piece, ...e.detail })), improvedPieces: improved,
    trace: trace.map(({ t_ms, piece, step, detail }) => ({ t_ms, piece, step, detail })) }, null, 2));
  // Saved before asserting, so a failed run still leaves its trace.
  assert(!events.some(e => e.t === "error"), `${slug}: ${JSON.stringify(events.find(e => e.t === "error"))}`);
  assert(look?.pieces?.length && look.vision?.length, `${slug}: missing perception`);
  assert(trace.some(e => e.step === "perceive"), `${slug}: no perceive step`);
  assert(trace.some(e => e.step === "score") && trace.some(e => e.step === "decide"), `${slug}: no score or decide step`);
  assert(done && done.ms <= 30_500, `${slug}: search exceeded 30 seconds`);
  assert(done.found! > 0, `${slug}: no matches`);

  console.log(JSON.stringify({ slug, model, elapsedMs, streamMs: done.ms, found: done.found, requested: look.pieces.length, retries: retries.length, improved: improved.length,
    approvals: events.filter(e => e.t === "approval").length, trace: path.relative(process.cwd(), tracePath) }));
}

for (const [options, expected] of [
  [{ method: "POST", headers: { "Content-Type": "text/plain" }, body: "not an image" }, 400],
  [{ method: "POST", headers: { Origin: "https://example.com" } }, 403],
] as const) assert.equal((await fetch(`${base}/api/screenshot-costume`, options)).status, expected);

if (requireRetry) assert(improvedRetries > 0, "No retry found a better match in this run");
console.log(`Screenshot agent checks passed (${improvedRetries} retries improved a match).`);
