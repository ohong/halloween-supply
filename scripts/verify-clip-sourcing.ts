// Exercises the real route's disabled and invalid-input paths without provider calls.
// Optional --provider --upload /path/to/clip.mp4 performs video analysis only, without shop sourcing.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

type BunRuntime = { plugin(plugin: { name: string; setup(build: { module(name: string, loader: () => unknown): void }): void }): void };
(globalThis as unknown as { Bun: BunRuntime }).Bun.plugin({
  name: "clip-route-checks", setup(build) { build.module("server-only", () => ({ exports: {}, loader: "object" })); },
});

const names = ["CLIP_COSTUME_ENABLED", "GEMINI_CLIP_MODEL", "GEMINI_API_KEY", "OPENAI_API_KEY", "FIRECRAWL_API_KEY"] as const;
const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
const { GET, POST } = await import("../app/api/clip-costume/route");
const { analyzeClip, parseYouTubeId } = await import("../lib/sourcing/clip-vision");
const origin = "http://localhost:3401";
const endpoint = `${origin}/api/clip-costume`;
let checks = 0;

async function expectStatus(body: FormData | string, status: number, extra: Record<string, string> = {}) {
  const response = await POST(new Request(endpoint, { method: "POST", headers: { Origin: origin, ...extra }, body }));
  assert.equal(response.status, status, JSON.stringify(await response.clone().json()));
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  checks++;
}
const link = (url: string) => { const form = new FormData(); form.set("youtube", url); return form; };
function upload(bytes: Uint8Array = new TextEncoder().encode("0000ftyp00000000"), mime = "video/mp4", frame?: Blob) {
  const form = new FormData();
  form.set("clip", new File([bytes as BlobPart], "clip.mp4", { type: mime }));
  if (frame) form.set("frame", frame, "frame.jpg");
  return form;
}

try {
  delete process.env.CLIP_COSTUME_ENABLED;
  assert.deepEqual(await GET().json(), { enabled: false }); checks++;
  await expectStatus(link("https://youtu.be/9hE5-98ZeCg"), 503);
  Object.assign(process.env, { CLIP_COSTUME_ENABLED: "1", GEMINI_API_KEY: "invalid-input-check", OPENAI_API_KEY: "invalid-input-check", FIRECRAWL_API_KEY: "invalid-input-check" });
  delete process.env.GEMINI_CLIP_MODEL;
  assert.deepEqual(await GET().json(), { enabled: false }); checks++;
  await expectStatus(link("https://youtu.be/9hE5-98ZeCg"), 503);
  process.env.GEMINI_CLIP_MODEL = "configured-model";
  assert.deepEqual(await GET().json(), { enabled: true }); checks++;
  await expectStatus("not multipart", 400);
  await expectStatus(new FormData(), 400);
  await expectStatus(new FormData(), 403, { Origin: "https://other.example" });
  await expectStatus(new FormData(), 413, { "Content-Length": "4500001" });
  for (const url of ["http://127.0.0.1/private", "https://youtube.com.evil.example/watch?v=9hE5-98ZeCg", "file:///etc/passwd", "https://youtu.be/short", "https://user:password@youtu.be/9hE5-98ZeCg", "https://youtu.be:8443/9hE5-98ZeCg"]) {
    assert.equal(parseYouTubeId(url), null);
    await expectStatus(link(url), 400);
  }
  assert.equal(parseYouTubeId("https://www.youtube.com/shorts/9hE5-98ZeCg?feature=share"), "9hE5-98ZeCg"); checks++;
  await expectStatus(upload(new Uint8Array(4 * 1024 * 1024 + 1)), 413);
  await expectStatus(upload(new Uint8Array(16), "text/plain"), 400);
  await expectStatus(upload(new Uint8Array(16)), 400);
  await expectStatus(upload(), 400);
  await expectStatus(upload(undefined, undefined, new Blob([new Uint8Array(200 * 1024 + 1)], { type: "image/jpeg" })), 413);
  await expectStatus(upload(undefined, undefined, new Blob(["not an image"], { type: "image/jpeg" })), 400);
  const both = upload(); both.set("youtube", "https://youtu.be/9hE5-98ZeCg");
  await expectStatus(both, 400);
  // The reader also enforces the cap when no content length is supplied.
  const raw = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(4_500_001)); controller.close(); } });
  const over = await POST(new Request(endpoint, { method: "POST", headers: { Origin: origin, "Content-Type": "multipart/form-data; boundary=clip-check" }, body: raw, duplex: "half" } as RequestInit));
  assert.equal(over.status, 413); checks++;
  console.log(JSON.stringify({ checks, ok: true, providerCalls: 0, scope: "real route guards and input validation" }));
} finally {
  for (const name of names) { const value = previous[name]; if (value === undefined) delete process.env[name]; else process.env[name] = value; }
}

if (process.argv.includes("--provider")) {
  assert(process.env.GEMINI_API_KEY && process.env.GEMINI_CLIP_MODEL, "Set GEMINI_API_KEY and an explicit GEMINI_CLIP_MODEL for a provider check.");
  const uploadAt = process.argv.indexOf("--upload");
  const youtubeAt = process.argv.indexOf("--youtube");
  assert((uploadAt >= 0) !== (youtubeAt >= 0), "Pass --upload /path/to/clip.mp4 or --youtube public-video-url.");
  const source = uploadAt >= 0
    ? { kind: "upload" as const, data: await readFile(process.argv[uploadAt + 1]), mime: "video/mp4" }
    : { kind: "youtube" as const, id: parseYouTubeId(process.argv[youtubeAt + 1]) ?? "" };
  const started = performance.now();
  try {
    const result = await analyzeClip(source, AbortSignal.timeout(90_000));
    console.log(JSON.stringify({ ok: true, model: process.env.GEMINI_CLIP_MODEL, kind: source.kind, pieces: result.look.pieces.length, bestFrameSeconds: result.bestFrameSeconds, ms: Math.round(performance.now() - started), scope: "video analysis only; no shop sourcing" }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, model: process.env.GEMINI_CLIP_MODEL, error: error instanceof Error ? error.message : "Provider check failed", ms: Math.round(performance.now() - started) }));
    process.exitCode = 1;
  }
}
