/** Real GPT Live, vision and Lucy check with synthetic media only.
 * LIVE_MIRROR_E2E=1 MIRROR_BASE_URL=http://localhost:3028 node scripts/verify-mirror-feedback.mjs
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

assert.equal(process.env.LIVE_MIRROR_E2E, "1", "Opt in to real provider usage.");
const origin = new URL(process.env.MIRROR_BASE_URL ?? "http://localhost:3028").origin;
const evidence = process.env.MIRROR_EVIDENCE_DIR ?? mkdtempSync(path.join(tmpdir(), "mirror-feedback-"));
mkdirSync(evidence, { recursive: true });
const camera = path.join(evidence, "camera.y4m");
const microphone = path.join(evidence, "speech.wav");
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", "public/costumes/models/cosmic-cowboy-male.webp", "-t", "3", "-vf", "crop=480:480:240:0,scale=720:720,pad=1280:720:280:0:color=black", "-r", "15", "-pix_fmt", "yuv420p", camera]);
const phrases = [[14000, "How do I look in this costume?"], [36000, "Compare my likeness with the original camera. Has the preview changed my face?"]];
const inputs = phrases.flatMap(([, text], index) => {
  const file = path.join(evidence, `speech-${index}.aiff`);
  execFileSync("say", ["-o", file, text]); return ["-i", file];
});
const filter = phrases.map(([delay], index) => `[${index}:a]adelay=${delay}:all=1[a${index}]`).join(";") + ";[a0][a1]amix=inputs=2:normalize=0,apad=whole_dur=70[out]";
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "[out]", "-ar", "48000", "-ac", "1", microphone]);
const browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${camera}`, `--use-file-for-fake-audio-capture=${microphone}`, "--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["camera", "microphone"] });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const requests = [], assessments = [], errors = [], checks = [];
const start = Date.now();
const log = (check, detail = {}) => { const item = { check, ms: Date.now() - start, ...detail }; checks.push(item); console.log(JSON.stringify(item)); };
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => {
  if (!request.url().endsWith("/api/live-mirror/feedback")) return;
  const input = request.postDataJSON();
  requests.push({ mode: input.mode, frozen: input.frozen, consent: input.consent, hasOriginal: Object.hasOwn(input, "original"), previewBytes: input.preview.length, originalBytes: input.original?.length });
});
page.on("response", async response => {
  if (response.url().endsWith("/api/live-mirror/feedback")) assessments.push({ status: response.status(), ...await response.json() });
});
await page.addInitScript(() => {
  window.visualTest = { events: [], sent: [], tracks: [], peers: [] };
  const Peer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Peer {
    constructor(...args) { super(...args); window.visualTest.peers.push(this); }
    createDataChannel(...args) {
      const channel = super.createDataChannel(...args);
      const send = channel.send.bind(channel);
      channel.send = data => { try { window.visualTest.sent.push(JSON.parse(data)); } catch {} return send(data); };
      channel.addEventListener("message", ({ data }) => { try { window.visualTest.events.push(JSON.parse(data)); } catch {} });
      return channel;
    }
  };
  const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await capture(...args); window.visualTest.tracks.push(...stream.getTracks()); return stream; };
});
try {
  for (const [body, headers, status] of [
    [{ mode: "style", question: "How do I look?", preview: "https://untrusted.invalid/image.jpg", frozen: false, consent: true }, { origin }, 400],
    [{ mode: "likeness", question: "Compare", preview: "data:image/jpeg;base64,AAAA", frozen: false, consent: true }, { origin }, 400],
    [{ mode: "style", question: "Look", preview: "data:image/jpeg;base64,AAAA", frozen: false, consent: false }, { origin }, 400],
    [{}, { origin: "https://unrelated.invalid" }, 403],
  ]) assert.equal((await context.request.post(`${origin}/api/live-mirror/feedback`, { headers, data: body })).status(), status);
  log("invalid-images-missing-original-consent-and-origin-rejected");
  await page.goto(`${origin}/costumes/pumpkin-harlequin`);
  await page.getByRole("tab", { name: "Try it on", exact: true }).click();
  await page.getByRole("button", { name: "Try it on live", exact: true }).click();
  const dialog = page.getByRole("dialog");
  assert.equal(requests.length, 0);
  await page.getByLabel("Tell us how to change your look").fill("How do I look?");
  const denied = page.waitForResponse(response => response.url().endsWith("/api/live-mirror/command"));
  await page.getByRole("button", { name: "Send styling request", exact: true }).click();
  assert.equal((await denied).status(), 200);
  await dialog.getByText("Allow image processing before asking for visual feedback.", { exact: true }).waitFor();
  assert.equal(requests.length, 0);
  log("appearance-question-without-consent-does-not-upload");
  await dialog.getByRole("checkbox").check();
  const selected = () => page.locator(".mirror-pieces select").evaluateAll(items => items.map(item => item.value));
  const before = await selected();
  await page.getByRole("button", { name: "Start my mirror", exact: true }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector('video[aria-label="Live costume preview"]');
    return video?.videoWidth > 0 && video.currentTime > 1;
  }, {}, { timeout: 45000 });
  assert.equal(requests.length, 0, "No visual uploads before a question");
  log("real-video-with-no-background-visual-uploads");
  await page.waitForResponse(response => response.url().endsWith("/api/live-mirror/feedback") && response.status() === 200, { timeout: 40000 });
  assert.equal(requests.at(-1).mode, "style");
  assert.equal(requests.at(-1).hasOriginal, false);
  await page.waitForFunction(() => window.visualTest.sent.some(event => event.type === "session.commentary.append" && event.content?.includes("Fresh visual assessment")), {}, { timeout: 10000 });
  assert.deepEqual(await selected(), before);
  log("spoken-style-question-uses-preview-only-and-keeps-outfit");
  await page.getByRole("button", { name: "Freeze look", exact: true }).click();
  await page.getByRole("img", { name: "Your frozen costume preview", exact: true }).waitFor();
  await page.waitForResponse(response => response.url().endsWith("/api/live-mirror/feedback") && response.status() === 200, { timeout: 40000 });
  assert.deepEqual(requests.at(-1), { ...requests.at(-1), mode: "likeness", hasOriginal: true, frozen: true, consent: true });
  assert(requests.every(request => request.previewBytes <= 700000 && (!request.originalBytes || request.originalBytes <= 700000)));
  assert.deepEqual(await selected(), before);
  log("spoken-likeness-question-uses-frozen-preview-and-paired-original");
  await page.waitForFunction(() => {
    const events = window.visualTest.events;
    const compare = events.findLastIndex(event => event.type === "decision.event" && event.delegation_id && event.event?.decision?.answers?.some(answer => answer.name === "visual_feedback" && answer.choice === "likeness"));
    const reply = events.slice(compare).filter(event => event.type === "session.output_transcript.delta").map(event => event.delta).join("");
    return compare >= 0 && reply.length > 150 && /face|features|likeness|original/i.test(reply);
  }, {}, { timeout: 15000 });
  const spoken = await page.evaluate(() => window.visualTest.events.filter(event => event.type === "session.output_transcript.delta").map(event => event.delta).join(""));
  assert(spoken.length > 50);
  await page.screenshot({ path: path.join(evidence, "visual-feedback.png") });
  // Typed questions use the same snapshot path and retain the frozen original.
  await page.getByRole("button", { name: "Mute microphone", exact: true }).click();
  await page.getByLabel("Tell us how to change your look").fill("How do I look in this frozen preview?");
  const typed = page.waitForResponse(response => response.url().endsWith("/api/live-mirror/feedback") && response.status() === 200);
  await page.getByRole("button", { name: "Send styling request", exact: true }).click();
  await typed;
  assert.equal(requests.at(-1).mode, "style");
  assert.equal(requests.at(-1).hasOriginal, false);
  assert.equal(requests.at(-1).frozen, true);
  assert.deepEqual(await selected(), before);
  await page.getByRole("button", { name: "Close costume mirror", exact: true }).click();
  await page.waitForFunction(() => window.visualTest.tracks.every(track => track.readyState === "ended") && window.visualTest.peers.every(peer => peer.connectionState === "closed"));
  assert.deepEqual(errors, []);
  log("typed-feedback-and-media-cleanup", { spoken });
  log("PASS");
} catch (error) {
  await page.screenshot({ path: path.join(evidence, "failure.png") }).catch(() => {});
  log("FAIL", { message: error.message, dialog: await page.getByRole("dialog").innerText().catch(() => "closed") });
  throw error;
} finally {
  await browser.close();
  writeFileSync(path.join(evidence, "results.json"), JSON.stringify({ origin, checks, requests, assessments, errors }, null, 2));
}
