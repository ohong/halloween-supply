/** Real-provider E2E. Opt in: LIVE_MIRROR_E2E=1 node scripts/verify-live-mirror.mjs
 * Uses a catalog mannequin as the camera and synthesized speech as the microphone.
 * Calls fal/OpenAI and consumes credits. No personal camera or microphone is opened.
 * Requires ffmpeg and macOS `say`, or MIRROR_TEST_VIDEO (Y4M) and MIRROR_TEST_AUDIO
 * (48 kHz mono WAV: jacket request at 10s, cape request at 30s).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

assert.equal(process.env.LIVE_MIRROR_E2E, "1", "Set LIVE_MIRROR_E2E=1 to authorize this paid provider test.");
const origin = new URL(process.env.MIRROR_BASE_URL ?? "http://localhost:3025").origin;
const evidence = process.env.MIRROR_EVIDENCE_DIR ?? mkdtempSync(path.join(tmpdir(), "mirror-e2e-"));
mkdirSync(evidence, { recursive: true });
const camera = process.env.MIRROR_TEST_VIDEO ?? path.join(evidence, "camera.y4m");
const microphone = process.env.MIRROR_TEST_AUDIO ?? path.join(evidence, "speech.wav");
if (!process.env.MIRROR_TEST_VIDEO) execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", "public/costumes/cosmic-cowboy.png", "-t", "5", "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=white", "-r", "15", "-pix_fmt", "yuv420p", camera]);
if (!process.env.MIRROR_TEST_AUDIO) {
  const jacket = path.join(evidence, "jacket.aiff");
  const cape = path.join(evidence, "cape.aiff");
  execFileSync("say", ["-o", jacket, "Keep the hat. Choose the cheapest jacket."]);
  execFileSync("say", ["-o", cape, "Choose the cheapest cape."]);
  // Chromium loops this file. Silence prevents old requests repeating during later checks.
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", jacket, "-i", cape, "-filter_complex", "[0:a]adelay=10000,apad=whole_dur=30[a];[1:a]apad=whole_dur=210[b];[a][b]concat=n=2:v=0:a=1[out]", "-map", "[out]", "-ar", "48000", "-ac", "1", microphone]);
}
const speech = {};
for (const [name, offset] of [["jacket", 10], ["cape", 30]]) {
  const file = path.join(evidence, `${name}.wav`);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", microphone, "-ss", String(offset), "-t", "10", "-ar", "48000", "-ac", "1", file]);
  speech[name] = readFileSync(file).toString("base64");
}
const browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${camera}`, "--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, permissions: ["camera", "microphone"], acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const observations = [];
const errors = [];
const started = Date.now();
const log = (check, detail = {}) => { const result = { check, ms: Date.now() - started, ...detail }; observations.push(result); console.log(JSON.stringify(result)); };
page.on("pageerror", error => errors.push(error.message));
page.on("websocket", socket => {
  if (!new URL(socket.url()).hostname.includes("fal")) return;
  socket.on("socketerror", message => log("video-signaling-error", { message }));
});
page.on("request", request => { if (request.url().includes("/api/live-mirror/")) log("request", { path: new URL(request.url()).pathname, method: request.method() }); });
page.on("requestfailed", request => { if (request.url().includes("/api/live-mirror/")) log("request-failed", { path: new URL(request.url()).pathname, reason: request.failure()?.errorText }); });
page.on("response", response => { if (response.url().includes("/api/live-mirror/")) log("route", { path: new URL(response.url()).pathname, method: response.request().method(), status: response.status() }); });
page.on("response", async response => {
  const route = new URL(response.url()).pathname;
  if (!["/api/live-mirror/command", "/api/live-mirror/mix"].includes(route) || response.request().method() !== "POST") return;
  const result = await response.json().catch(() => ({}));
  log("command-result", { route, actions: result.actions, selection: result.outfit?.selection, message: result.message, error: result.error });
});
await page.addInitScript(speech => {
  window.mirrorTest = { peers: [], tracks: [], events: [] };
  let input;
  // Send synthetic speech only after the real provider and current look are ready.
  window.mirrorTest.say = async name => {
    if (!input) throw new Error("Synthetic microphone is not connected");
    const bytes = Uint8Array.from(atob(speech[name]), value => value.charCodeAt(0));
    const source = input.context.createBufferSource();
    source.buffer = await input.context.decodeAudioData(bytes.buffer);
    source.connect(input.destination);
    await input.context.resume();
    await new Promise(resolve => { source.onended = resolve; source.start(); });
    source.disconnect();
  };
  const Peer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Peer {
    constructor(...args) { super(...args); window.mirrorTest.peers.push(this); }
    createDataChannel(...args) {
      const channel = super.createDataChannel(...args);
      const send = channel.send.bind(channel);
      let closing = false;
      channel.send = data => {
        try {
          const event = JSON.parse(data);
          if (event.type === "session.close") closing = true;
          window.mirrorTest.events.push({ time: performance.now(), direction: "send", type: event.type, eventId: event.event_id, look: event.session?.delegation?.decisions?.questions?.find(question => question.name === "look")?.instructions });
        } catch { /* Binary transport data is outside this check. */ }
        return send(data);
      };
      channel.addEventListener("message", ({ data }) => {
        try {
          const event = JSON.parse(data);
          window.mirrorTest.events.push({ time: performance.now(), type: event.type, delta: event.delta, error: event.type === "error", errorCode: event.error?.code, errorMessage: event.error?.message, closing, delegationId: event.delegation_id ?? event.delegation?.id, clientEventId: event.client_event_id, answers: event.event?.decision?.answers });
        } catch { /* Ignore non-JSON transport messages. */ }
      });
      return channel;
    }
  };
  const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (...args) => {
    let stream;
    if (args[0]?.audio && !args[0]?.video) {
      const context = new AudioContext();
      const destination = context.createMediaStreamDestination();
      const silence = context.createConstantSource();
      silence.offset.value = 0;
      silence.connect(destination);
      silence.start();
      await context.resume();
      input = { context, destination };
      stream = destination.stream;
    } else stream = await getUserMedia(...args);
    window.mirrorTest.tracks.push(...stream.getTracks());
    return stream;
  };
}, speech);
const selections = () => page.locator(".mirror-pieces select").evaluateAll(elements => elements.map(element => element.value));
const waitForVideo = async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await page.waitForFunction(() => {
      const video = document.querySelector('video[aria-label="Live costume preview"]');
      return video?.videoWidth > 0 && video.currentTime > 0 ? "live" : document.querySelector(".mirror-error")?.textContent ? "error" : false;
    }, {}, { timeout: 60000 });
    if (await result.jsonValue() === "live") return;
    const retry = page.getByRole("button", { name: "Start my mirror", exact: true });
    if (attempt) throw new Error(await page.locator(".mirror-error").innerText());
    await retry.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll(".mirror-start button")].some(button => button.textContent === "Start my mirror" && !button.disabled));
    log("explicit-video-retry", { error: await page.locator(".mirror-error").innerText() });
    await retry.click();
  }
};
const postCommand = async text => {
  await page.getByLabel("Tell us how to change your look").fill(text);
  const response = page.waitForResponse(response => response.url().endsWith("/api/live-mirror/command"));
  await page.getByRole("button", { name: "Send styling request", exact: true }).click();
  const completed = await response;
  assert.equal(completed.status(), 200);
  const command = await completed.json();
  log("typed-command", { text, actions: command.actions, message: command.message });
};
try {
  // Bootstrap the deployment's access cookie without persisting it or logging the URL.
  if (process.env.MIRROR_ACCESS_URL) await page.goto(process.env.MIRROR_ACCESS_URL);
  for (const [headers, data, status] of [
    [{ origin: "https://unrelated.invalid" }, { consent: true }, 403],
    [{ origin }, { consent: false }, 400],
  ]) assert.equal((await context.request.post(`${origin}/api/live-mirror/video`, { headers, data })).status(), status);
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
  await page.getByRole("button", { name: "Mute microphone", exact: true }).waitFor();
  await page.evaluate(() => window.mirrorTest.say("jacket"));
  await page.waitForFunction(id => document.getElementById("mirror-piece-fringe-jacket")?.value === id, cheapJacket, { timeout: 30000 });
  const afterVoice = await selections();
  assert.deepEqual(afterVoice.filter((_, index) => index !== 1), original.filter((_, index) => index !== 1));
  assert.equal(await page.getByLabel("Silver cowboy hat", { exact: true }).isEnabled(), false);
  log("spoken-jacket-request-keeps-other-pieces");
  await page.locator(".mirror-details summary").click();
  await page.getByLabel("Costume", { exact: true }).selectOption("velvet-vampire");
  await page.waitForFunction(() => {
    const update = window.mirrorTest.events.findLast(event => event.direction === "send" && event.type === "session.update" && event.look?.includes("Current look: Velvet Vampire."));
    return update && window.mirrorTest.events.some(event => event.type === "session.updated" && event.clientEventId === update.eventId);
  }, {}, { timeout: 15000 });
  assert.deepEqual(await page.evaluate(() => window.mirrorTest.peers.filter(peer => peer.connectionState !== "closed").map(peer => peer.connectionState)), ["connected", "connected"]);
  const vampireBefore = await selections();
  const vampire = await (await context.request.get(`${origin}/api/live-mirror/catalog?slug=velvet-vampire`)).json();
  const cape = vampire.pieces[0];
  const cheapCape = [...cape.options].sort((a, b) => a.product.priceCents - b.product.priceCents)[0].product.id;
  await page.evaluate(() => window.mirrorTest.say("cape"));
  await page.waitForFunction(({ id, value }) => document.getElementById(`mirror-piece-${id}`)?.value === value, { id: cape.piece.id, value: cheapCape }, { timeout: 60000 });
  assert.deepEqual((await selections()).slice(1), vampireBefore.slice(1));
  await page.waitForFunction(() => [...document.querySelectorAll(".live-transcript-speaker")].filter(element => element.textContent === "Stylist").length >= 2, {}, { timeout: 10000 });
  log("spoken-cape-request-after-live-catalog-switch");
  await page.getByRole("button", { name: "Mute microphone", exact: true }).click();
  await page.locator('.voice-state[data-state="muted"]').waitFor();
  assert(await page.evaluate(() => window.mirrorTest.tracks.filter(track => track.kind === "audio" && track.readyState === "live").every(track => !track.enabled)));
  await page.getByRole("button", { name: "Unmute microphone", exact: true }).click();
  assert(await page.evaluate(() => window.mirrorTest.tracks.some(track => track.kind === "audio" && track.readyState === "live" && track.enabled)));
  log("mute-and-unmute-real-microphone-track");
  await postCommand("I already own the boots.");
  const ownedBoots = page.locator(".mirror-piece").filter({ has: page.locator("#mirror-piece-vampire-boots") });
  await ownedBoots.getByText(/Already owned/).waitFor();
  assert.deepEqual(await page.locator(".mirror-piece").evaluateAll(rows => rows.filter(row => row.querySelector("p")?.textContent.includes("Already owned")).map(row => row.querySelector("select").id)), ["mirror-piece-vampire-boots"], "An ownership request must not change an unrelated piece");
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
  await page.screenshot({ path: path.join(evidence, "resumed-live-mirror.png") });
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
  await page.getByRole("button", { name: "End voice", exact: true }).click();
  await page.locator('.voice-state[data-state="idle"]').waitFor();
  assert(await page.evaluate(() => window.mirrorTest.tracks.filter(track => track.kind === "audio").every(track => track.readyState === "ended")));
  assert(await page.evaluate(() => window.mirrorTest.tracks.some(track => track.kind === "video" && track.readyState === "live")));
  await page.getByRole("button", { name: "Start voice styling", exact: true }).click();
  await page.getByRole("button", { name: "Mute microphone", exact: true }).waitFor();
  assert(await page.evaluate(() => window.mirrorTest.tracks.some(track => track.kind === "audio" && track.readyState === "live")));
  log("end-voice-releases-microphone-and-restart-restores-it");
  await page.getByRole("button", { name: "Close costume mirror", exact: true }).click();
  await page.waitForFunction(() => window.mirrorTest.peers.every(peer => peer.connectionState === "closed") && window.mirrorTest.tracks.every(track => track.readyState === "ended"), {}, { timeout: 5000 });
  log("all-media-released-on-close");
  const events = await page.evaluate(() => window.mirrorTest.events);
  writeFileSync(path.join(evidence, "session-events.json"), JSON.stringify(events, null, 2));
  // Closing deliberately cancels pending context injection. Other provider errors fail.
  assert.deepEqual(events.filter(event => event.error && !(event.closing && event.errorCode === "context_injection_incomplete")), []);
  assert(events.some(event => event.type === "decision.item.created"));
  log("native-decision-context-accepted-without-active-session-errors");
  // Verify the destination restores owned pieces without starting another session.
  await page.goto(new URL(href, origin).href);
  await page.getByRole("tab", { name: "Try it on", exact: true }).click();
  await page.getByRole("button", { name: "Try it on live", exact: true }).click();
  await page.locator(".mirror-details summary").click();
  await ownedBoots.getByText(/Already owned/).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const nextLook = await page.locator("#mirror-look").evaluate(select => select.options[(select.selectedIndex + 1) % select.options.length].value);
  await page.locator(".mirror-stage").scrollIntoViewIfNeeded();
  const stage = await page.locator(".mirror-stage").boundingBox();
  await page.mouse.move(stage.x + stage.width * 0.8, stage.y + stage.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width * 0.2, stage.y + stage.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(slug => document.getElementById("mirror-look")?.value === slug, nextLook);
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
  writeFileSync(path.join(evidence, "voice-events.json"), JSON.stringify(await page.evaluate(() => window.mirrorTest.events).catch(() => []), null, 2));
  await browser.close();
  writeFileSync(path.join(evidence, "results.json"), JSON.stringify({ origin, observations, errors }, null, 2));
}
