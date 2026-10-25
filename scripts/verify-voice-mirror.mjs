/** Real GPT Live + Lucy E2E with synthetic media; never opens personal devices.
 * LIVE_MIRROR_E2E=1 MIRROR_BASE_URL=http://localhost:3028 node scripts/verify-voice-mirror.mjs
 * Uses provider credits. Requires macOS say, ffmpeg, and Playwright Chromium.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

assert.equal(process.env.LIVE_MIRROR_E2E, "1", "Opt in to real provider usage with LIVE_MIRROR_E2E=1.");
const origin = new URL(process.env.MIRROR_BASE_URL ?? "http://localhost:3028").origin;
const evidence = process.env.MIRROR_EVIDENCE_DIR ?? mkdtempSync(path.join(tmpdir(), "voice-mirror-"));
const camera = path.join(evidence, "camera.y4m");
const microphone = path.join(evidence, "speech.wav");
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", "public/costumes/cosmic-cowboy.png", "-t", "4", "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=white", "-r", "15", "-pix_fmt", "yuv420p", camera]);
const phrases = [
  [8000, "Try the full Velvet Vampire costume."],
  [24000, "Make the cape bright blue in the preview. Keep everything else."],
  [42000, "Choose the cheapest cape. Keep everything else."],
  [58000, "Change my Halloween costume for me. Surprise me with something different."],
];
const inputs = phrases.flatMap(([, text], index) => {
  const file = path.join(evidence, `phrase-${index}.aiff`);
  execFileSync("say", ["-o", file, text]);
  return ["-i", file];
});
const filter = phrases.map(([delay], index) => `[${index}:a]adelay=${delay}:all=1[a${index}]`).join(";") + ";" + phrases.map((_, index) => `[a${index}]`).join("") + `amix=inputs=${phrases.length}:normalize=0,apad=whole_dur=90[out]`;
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "[out]", "-ar", "48000", "-ac", "1", microphone]);
const browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${camera}`, `--use-file-for-fake-audio-capture=${microphone}`, "--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["camera", "microphone"], acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const checks = [], errors = [], requests = [];
page.on("console", message => { if (message.type() === "warning") console.log("browser-warning", message.text().replace(/https?:\/\/\S+/g, "[url]")); });
const started = Date.now();
function log(check, data = {}) { const item = { check, ms: Date.now() - started, ...data }; checks.push(item); console.log(JSON.stringify(item)); }
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => {
  if (request.url().endsWith("/api/live-mirror/reference")) requests.push(request.postDataJSON());
});
await page.addInitScript(() => {
  window.voiceMirrorTest = { peers: [], tracks: [], events: [], sent: [] };
  const Peer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Peer {
    constructor(...args) { super(...args); window.voiceMirrorTest.peers.push(this); }
    createDataChannel(...args) {
      const channel = super.createDataChannel(...args);
      const send = channel.send.bind(channel);
      channel.send = data => { try { window.voiceMirrorTest.sent.push(JSON.parse(data)); } catch {} return send(data); };
      channel.addEventListener("message", ({ data }) => { try { window.voiceMirrorTest.events.push(JSON.parse(data)); } catch {} });
      return channel;
    }
  };
  const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await capture(...args); window.voiceMirrorTest.tracks.push(...stream.getTracks()); return stream; };
});
const selected = () => page.locator(".mirror-pieces select").evaluateAll(elements => elements.map(element => element.value));
const waitVideo = () => page.waitForFunction(() => {
  const video = document.querySelector('video[aria-label="Live costume preview"]');
  return video?.videoWidth > 0 && video.currentTime > 0;
}, null, { timeout: 45000 });
try {
  await page.goto(`${origin}/costumes/cosmic-cowboy`);
  await page.getByRole("tab", { name: "Try it on", exact: true }).click();
  await page.getByRole("button", { name: "Try it on live", exact: true }).click();
  const start = page.getByRole("button", { name: "Start my mirror", exact: true });
  assert.equal(await start.isEnabled(), false);
  assert.equal(await page.evaluate(() => window.voiceMirrorTest.tracks.length), 0);
  assert.equal(await page.locator(".mirror-details").getAttribute("open"), null);
  const stage = await page.locator(".mirror-stage").boundingBox();
  const sidebar = await page.locator(".mirror-workbench").boundingBox();
  assert(stage.width > sidebar.width * 2.5);
  assert((await start.boundingBox()).y < 1000);
  await page.screenshot({ path: path.join(evidence, "desktop-ready.png") });
  log("video-dominates-and-no-capture-before-consent", { videoWidth: stage.width, sidebarWidth: sidebar.width });
  await page.getByRole("dialog").getByRole("checkbox").check();
  await start.click();
  await waitVideo();
  log("real-decoded-video");
  await page.waitForFunction(() => document.getElementById("mirror-look")?.value === "velvet-vampire", null, { timeout: 25000 });
  const before = await selected();
  const vampire = await (await context.request.get(`${origin}/api/live-mirror/catalog?slug=velvet-vampire`)).json();
  const cape = vampire.pieces.find(({ piece }) => /cape/i.test(piece.name));
  assert(cape);
  const cheapCape = [...cape.options].filter(option => option.product.availability !== "out_of_stock").sort((a, b) => a.product.priceCents - b.product.priceCents)[0].product.id;
  log("spoken-full-costume-switch");
  await page.waitForFunction(() => /bright blue/i.test(document.querySelector(".mirror-preview-edits")?.textContent ?? ""), null, { timeout: 25000 });
  await page.waitForFunction(() => !document.querySelector(".mirror-freeze")?.disabled);
  assert.deepEqual(await selected(), before);
  assert(requests.some(request => request.appearance?.[cape.piece.id]?.color === "bright blue"));
  const changedAt = await page.locator(".mirror-camera").evaluate(video => video.currentTime);
  await page.waitForFunction(time => document.querySelector(".mirror-camera").currentTime > time + 3, changedAt);
  await page.screenshot({ path: path.join(evidence, "blue-cape-live.png") });
  log("spoken-color-keeps-products-and-updates-renderer", { appearance: requests.at(-1).appearance });
  const connections = await page.evaluate(() => window.voiceMirrorTest.peers.length);
  await page.waitForFunction(({ id, value }) => document.getElementById(`mirror-piece-${id}`)?.value === value, { id: cape.piece.id, value: cheapCape }, { timeout: 25000 });
  const after = await selected();
  const capeIndex = vampire.pieces.findIndex(({ piece }) => piece.id === cape.piece.id);
  assert.deepEqual(after.filter((_, i) => i !== capeIndex), before.filter((_, i) => i !== capeIndex));
  log("spoken-piece-swap-preserves-other-pieces");
  await page.waitForFunction(() => document.getElementById("mirror-look")?.value !== "velvet-vampire", null, { timeout: 25000 });
  assert.equal(await page.evaluate(() => window.voiceMirrorTest.peers.length), connections);
  log("spoken-unspecified-costume-switch-keeps-connections");
  const stats = await page.evaluate(async () => {
    const records = [];
    for (const peer of window.voiceMirrorTest.peers) for (const item of (await peer.getStats()).values()) if (item.type === "inbound-rtp") records.push({ kind: item.kind, framesDecoded: item.framesDecoded, bytesReceived: item.bytesReceived });
    return records;
  });
  assert(stats.some(item => item.kind === "video" && item.framesDecoded > 0));
  assert(stats.some(item => item.kind === "audio" && item.bytesReceived > 0));
  assert(await page.evaluate(() => window.voiceMirrorTest.sent.some(event => event.type === "session.thinking.append" && event.content.includes('"status":"live"'))));
  await page.getByRole("button", { name: "Mute microphone", exact: true }).click();
  log("real-audio-video-and-screen-status-sync", { stats });
  assert.equal(await page.evaluate(() => window.voiceMirrorTest.events.some(event => event.type === "error")), false);
  // Finish the session before checking responsive layout to bound provider usage.
  await page.getByRole("button", { name: "Close costume mirror", exact: true }).click();
  await page.waitForFunction(() => window.voiceMirrorTest.peers.every(peer => peer.connectionState === "closed") && window.voiceMirrorTest.tracks.every(track => track.readyState === "ended"));
  log("all-media-released-on-close");
  await page.getByRole("button", { name: "Try it on live", exact: true }).click();
  const typeChange = async text => {
    await page.getByLabel("Tell us how to change your look").fill(text);
    const response = page.waitForResponse(response => response.url().endsWith("/api/live-mirror/command"));
    await page.getByRole("button", { name: "Send styling request", exact: true }).click();
    assert.equal((await response).status(), 200);
    await page.getByRole("button", { name: "Send styling request", exact: true }).waitFor({ state: "visible" });
  };
  await typeChange("Make the jacket red and the hat purple in the preview. Keep the same products.");
  await page.waitForFunction(() => /red/.test(document.querySelector(".mirror-preview-edits").textContent) && /purple/.test(document.querySelector(".mirror-preview-edits").textContent));
  await typeChange("Make the jacket leather. Keep its current color and keep everything else.");
  await page.waitForFunction(() => /red.*leather|leather.*red/.test(document.querySelector(".mirror-preview-edits").textContent));
  await page.getByRole("button", { name: "Undo last outfit change", exact: true }).click();
  await page.waitForFunction(() => !/leather/.test(document.querySelector(".mirror-preview-edits").textContent) && /red/.test(document.querySelector(".mirror-preview-edits").textContent));
  await typeChange("Restore the original colors of the jacket and the hat in the preview.");
  await page.waitForFunction(() => document.querySelector(".mirror-preview-edits").textContent === "");
  log("multiple-colors-material-preservation-undo-and-restore");
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.querySelector(".mirror-body").scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(evidence, "mobile-ready.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  log("PASS", { evidence });
} catch (error) {
  await page.screenshot({ path: path.join(evidence, "failure.png") }).catch(() => {});
  log("FAIL", { decisions: await page.evaluate(() => window.voiceMirrorTest.events.filter(event => event.type === "decision.event" && event.delegation_id).map(event => event.event?.decision?.answers?.map(({name, choice}) => ({name, choice})))), message: error.message, dialog: await page.getByRole("dialog").innerText({ timeout: 1000 }).catch(() => "closed"), events: await page.evaluate(() => window.voiceMirrorTest.events.filter(event => event.type === "error" || event.type === "session.closed" || event.type === "session.updated").map(event => ({ type: event.type, error: event.error, session: event.session ? { status: event.session.status } : undefined }))) });
  throw error;
} finally {
  await browser.close();
  writeFileSync(path.join(evidence, "results.json"), JSON.stringify({ origin, checks, errors, referenceRequests: requests }, null, 2));
}
