/** Real-provider E2E. Opt in: LIVE_MIRROR_E2E=1 node scripts/verify-live-mirror.mjs
 * Uses a catalog mannequin as the camera and synthesized speech as the microphone.
 * Calls fal/OpenAI and consumes credits. No personal camera or microphone is opened.
 * Requires ffmpeg and macOS `say`, or MIRROR_TEST_VIDEO (Y4M) and MIRROR_TEST_AUDIO
 * (48 kHz mono WAV: jacket request at 10s, cape request at 30s).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

assert.equal(process.env.LIVE_MIRROR_E2E, "1", "Set LIVE_MIRROR_E2E=1 to authorize this paid provider test.");
const origin = new URL(process.env.MIRROR_BASE_URL ?? "http://localhost:3025").origin;
const evidence = process.env.MIRROR_EVIDENCE_DIR ?? mkdtempSync(path.join(tmpdir(), "mirror-e2e-"));
const camera = process.env.MIRROR_TEST_VIDEO ?? path.join(evidence, "camera.y4m");
const microphone = process.env.MIRROR_TEST_AUDIO ?? path.join(evidence, "speech.wav");
if (!process.env.MIRROR_TEST_VIDEO) execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", "public/costumes/cosmic-cowboy.png", "-t", "5", "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=white", "-r", "15", "-pix_fmt", "yuv420p", camera]);
if (!process.env.MIRROR_TEST_AUDIO) {
  const jacket = path.join(evidence, "jacket.aiff");
  const cape = path.join(evidence, "cape.aiff");
  execFileSync("say", ["-o", jacket, "Keep the hat. Choose the cheapest jacket."]);
  execFileSync("say", ["-o", cape, "Choose the cheapest cape."]);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", jacket, "-i", cape, "-filter_complex", "[0:a]adelay=10000,apad=whole_dur=30[a];[1:a]apad=pad_dur=30[b];[a][b]concat=n=2:v=0:a=1[out]", "-map", "[out]", "-ar", "48000", "-ac", "1", microphone]);
}
const browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${camera}`, `--use-file-for-fake-audio-capture=${microphone}`, "--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, permissions: ["camera", "microphone"], acceptDownloads: true });
const page = await context.newPage();
const observations = [];
const errors = [];
const started = Date.now();
const log = (check, detail = {}) => { const result = { check, ms: Date.now() - started, ...detail }; observations.push(result); console.log(JSON.stringify(result)); };
page.on("pageerror", error => errors.push(error.message));
page.on("response", response => { if (response.url().includes("/api/live-mirror/")) log("route", { path: new URL(response.url()).pathname, status: response.status() }); });
await page.addInitScript(() => {
  window.mirrorTest = { peers: [], tracks: [], events: [] };
  const Peer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Peer {
    constructor(...args) { super(...args); window.mirrorTest.peers.push(this); }
    createDataChannel(...args) {
      const channel = super.createDataChannel(...args);
      channel.addEventListener("message", ({ data }) => {
        try {
          const event = JSON.parse(data);
          window.mirrorTest.events.push({ time: performance.now(), type: event.type, delta: event.delta, error: event.type === "error" });
        } catch { /* Ignore non-JSON transport messages. */ }
      });
      return channel;
    }
  };
  const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (...args) => {
    const stream = await getUserMedia(...args);
    window.mirrorTest.tracks.push(...stream.getTracks());
    return stream;
  };
});
const selections = () => page.locator(".mirror-pieces select").evaluateAll(elements => elements.map(element => element.value));
const waitForVideo = () => page.waitForFunction(() => {
  const video = document.querySelector('video[aria-label="Live costume preview"]');
  return video?.videoWidth > 0 && video.currentTime > 0;
}, {}, { timeout: 45000 });
const postCommand = async text => {
  await page.getByLabel("Tell us how to change your look").fill(text);
  const response = page.waitForResponse(response => response.url().endsWith("/api/live-mirror/command"));
  await page.getByRole("button", { name: "Send styling request", exact: true }).click();
  const completed = await response;
  assert.equal(completed.status(), 200);
  log("typed-command", { text, command: await completed.json() });
};
try {
  // Bootstrap the deployment's access cookie without persisting it or logging the URL.
  if (process.env.MIRROR_ACCESS_URL) await page.goto(process.env.MIRROR_ACCESS_URL);
  // Hosted firewall limits count rejected requests too. Exercise these checks
  // locally and reserve hosted allowance for the two real camera connections.
  if (["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) {
    for (const [headers, data, status] of [
      [{ origin: "https://unrelated.invalid" }, { consent: true }, 403],
      [{ origin }, { consent: false }, 400],
    ]) assert.equal((await context.request.post(`${origin}/api/live-mirror/video`, { headers, data })).status(), status);
  }
  await page.goto(`${origin}/costumes/cosmic-cowboy`);
  await page.getByRole("tab", { name: "Try it on", exact: true }).click();
  await page.getByRole("button", { name: "Try it on live", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Start my mirror", exact: true }).isEnabled(), false);
  assert.equal(await page.evaluate(() => window.mirrorTest.tracks.length), 0);
  const original = await selections();
  const cowboy = await (await context.request.get(`${origin}/api/live-mirror/catalog?slug=cosmic-cowboy`)).json();
  const jacket = cowboy.pieces.find(({ piece }) => piece.id === "fringe-jacket");
  const cheapJacket = [...jacket.options].sort((a, b) => a.product.priceCents - b.product.priceCents)[0].product.id;
  await page.getByRole("dialog").getByRole("checkbox").check();
  const connectionStart = Date.now();
  await page.getByRole("button", { name: "Start my mirror", exact: true }).click();
  await waitForVideo();
  log("real-video", { firstDecodedFrameMs: Date.now() - connectionStart });
  await page.waitForFunction(id => document.getElementById("mirror-piece-fringe-jacket")?.value === id, cheapJacket, { timeout: 30000 });
  const afterVoice = await selections();
  assert.deepEqual(afterVoice.filter((_, index) => index !== 1), original.filter((_, index) => index !== 1));
  assert.equal(await page.getByLabel("Silver cowboy hat", { exact: true }).isEnabled(), false);
  log("spoken-jacket-request-keeps-other-pieces");
  await page.locator(".mirror-details summary").click();
  await page.getByLabel("Costume", { exact: true }).selectOption("velvet-vampire");
  await page.waitForFunction(() => window.mirrorTest.events.some(event => event.type === "session.updated"), {}, { timeout: 10000 });
  assert.deepEqual(await page.evaluate(() => window.mirrorTest.peers.map(peer => peer.connectionState)), ["connected", "connected"]);
  const vampireBefore = await selections();
  const vampire = await (await context.request.get(`${origin}/api/live-mirror/catalog?slug=velvet-vampire`)).json();
  const cape = vampire.pieces[0];
  const cheapCape = [...cape.options].sort((a, b) => a.product.priceCents - b.product.priceCents)[0].product.id;
  await page.waitForFunction(({ id, value }) => document.getElementById(`mirror-piece-${id}`)?.value === value, { id: cape.piece.id, value: cheapCape }, { timeout: 30000 });
  assert.deepEqual((await selections()).slice(1), vampireBefore.slice(1));
  await page.waitForFunction(() => window.mirrorTest.events.filter(event => event.type === "session.commentary.appended").length >= 3, {}, { timeout: 10000 });
  log("spoken-cape-request-after-live-catalog-switch");
  await postCommand("I already own the boots.");
  await page.getByText(/Already owned/).waitFor();
  const shopLink = page.getByRole("link", { name: /Shop this look/ });
  const href = await shopLink.getAttribute("href");
  assert(new URL(href, origin).searchParams.get("owned"));
  await page.getByRole("button", { name: "Save this preview", exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('button.mirror-freeze')?.disabled);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save this preview", exact: true }).click();
  await (await downloadEvent).saveAs(path.join(evidence, "saved-preview.jpg"));
  await page.screenshot({ path: path.join(evidence, "live-mirror.png") });
  log("owned-piece-and-save");
  await page.getByRole("button", { name: "Freeze look", exact: true }).click();
  assert(await page.evaluate(() => window.mirrorTest.tracks.filter(track => track.kind === "video").every(track => track.readyState === "ended")));
  assert(await page.evaluate(() => window.mirrorTest.tracks.some(track => track.kind === "audio" && track.readyState === "live")));
  await page.getByRole("button", { name: "Resume camera", exact: true }).click();
  await waitForVideo();
  log("freeze-releases-camera-and-resume-restores-video");
  const stats = await page.evaluate(async () => {
    const records = [];
    for (const peer of window.mirrorTest.peers) {
      if (peer.connectionState === "closed") continue;
      for (const item of (await peer.getStats()).values()) if (item.type === "inbound-rtp") records.push({ kind: item.kind, bytesReceived: item.bytesReceived, framesDecoded: item.framesDecoded });
    }
    return records;
  });
  assert(stats.some(item => item.kind === "video" && item.framesDecoded > 0));
  assert(stats.some(item => item.kind === "audio" && item.bytesReceived > 0));
  log("received-provider-audio-and-video", { stats });
  const connectionsBefore = await page.evaluate(() => window.mirrorTest.peers.length);
  await postCommand("Try the full Moon Moth costume.");
  await page.waitForFunction(() => document.getElementById("mirror-look")?.value === "moon-moth");
  assert.equal(await page.evaluate(() => window.mirrorTest.peers.length), connectionsBefore);
  log("typed-full-costume-switch-keeps-connections");
  await page.getByRole("button", { name: "Close costume mirror", exact: true }).click();
  await page.waitForFunction(() => window.mirrorTest.peers.every(peer => peer.connectionState === "closed") && window.mirrorTest.tracks.every(track => track.readyState === "ended"), {}, { timeout: 5000 });
  log("all-media-released-on-close");
  // Verify the destination restores owned pieces without starting another session.
  await page.goto(new URL(href, origin).href);
  await page.getByRole("tab", { name: "Try it on", exact: true }).click();
  await page.getByRole("button", { name: "Try it on live", exact: true }).click();
  await page.locator(".mirror-details summary").click();
  await page.getByText(/Already owned/).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const stage = await page.locator(".mirror-stage").boundingBox();
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height * 0.25, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => document.getElementById("mirror-look")?.value === "cosmic-cowboy");
  await page.screenshot({ path: path.join(evidence, "mobile-mirror.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  log("shopping-state-mobile-layout-swipe-and-escape");
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => window.mirrorTest.events.some(event => event.error)), false);
  log("PASS", { evidence });
} catch (error) {
  await page.screenshot({ path: path.join(evidence, "failure.png") }).catch(() => {});
  log("FAIL", { evidence, message: error.message, dialog: await page.getByRole("dialog").innerText().catch(() => "closed") });
  throw error;
} finally {
  await browser.close();
  writeFileSync(path.join(evidence, "results.json"), JSON.stringify({ origin, observations, errors }, null, 2));
}
