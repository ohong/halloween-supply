/** Local UI verification with real loopback WebRTC and synthetic browser media.
 * No provider calls or physical microphone/camera access. Start `bun dev` first.
 * VOICE_STATE_BASE_URL=http://localhost:3062 node scripts/verify-voice-state.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const origin = new URL(process.env.VOICE_STATE_BASE_URL ?? "http://localhost:3062").origin;
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Run this fixture against localhost only.");
const evidence = process.env.VOICE_STATE_EVIDENCE_DIR ?? mkdtempSync(path.join(tmpdir(), "voice-state-"));
const browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, permissions: ["microphone"], reducedMotion: "reduce" });
const page = await context.newPage();
const errors = [];
const checks = [];
page.on("pageerror", error => errors.push(error.message));
let allowAnswer;
const answerGate = new Promise(resolve => { allowAnswer = resolve; });

await page.addInitScript(() => {
  const NativePeer = window.RTCPeerConnection;
  const fixture = window.voiceStateFixture = { peers: [], remote: null, channel: null, gain: null, context: null, samples: 0, remoteTracks: [] };
  window.RTCPeerConnection = class extends NativePeer {
    constructor(...args) { super(...args); fixture.peers.push(this); }
  };
  const nativeStats = RTCRtpReceiver.prototype.getStats;
  RTCRtpReceiver.prototype.getStats = function (...args) { fixture.samples++; return nativeStats.apply(this, args); };
  fixture.answer = async sdp => {
    const remote = new NativePeer({ iceServers: [] });
    fixture.remote = remote;
    remote.addEventListener("track", ({ track }) => fixture.remoteTracks.push(track));
    remote.addEventListener("datachannel", ({ channel }) => {
      fixture.channel = channel;
      channel.addEventListener("open", () => channel.send(JSON.stringify({ type: "session.started" })));
      channel.addEventListener("message", ({ data }) => {
        const event = JSON.parse(data);
        if (event.type === "decision.item.create") channel.send(JSON.stringify({ type: "decision.item.created", client_event_id: event.event_id }));
        if (event.type === "session.close") channel.send(JSON.stringify({ type: "session.closed" }));
      });
    });
    const audio = new AudioContext();
    fixture.context = audio;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const output = audio.createMediaStreamDestination();
    fixture.gain = gain;
    gain.gain.value = 0;
    oscillator.connect(gain).connect(output);
    oscillator.start();
    await audio.resume();
    output.stream.getTracks().forEach(track => remote.addTrack(track, output.stream));
    await remote.setRemoteDescription({ type: "offer", sdp });
    await remote.setLocalDescription(await remote.createAnswer());
    if (remote.iceGatheringState !== "complete") await new Promise(resolve => remote.addEventListener("icegatheringstatechange", () => { if (remote.iceGatheringState === "complete") resolve(); }));
    return remote.localDescription.sdp;
  };
});
await page.route("**/api/live-mirror/video", route => route.fulfill({ json: { videoAvailable: false, voiceAvailable: true } }));
await page.route("**/api/live-mirror/voice", async route => {
  const { sdp } = route.request().postDataJSON();
  const answer = await page.evaluate(sdp => window.voiceStateFixture.answer(sdp), sdp);
  await answerGate;
  await route.fulfill({ json: { transport: { sdp: answer } } });
});
const state = async expected => {
  await page.locator(`.voice-state[data-state="${expected}"]`).waitFor({ state: "visible", timeout: 15000 });
  checks.push(expected);
};
const emit = event => page.evaluate(event => window.voiceStateFixture.channel.send(JSON.stringify(event)), event);

try {
  await page.goto(`${origin}/costumes/cosmic-cowboy`);
  await page.getByRole("tab", { name: "Try it on", exact: true }).click();
  await page.getByRole("button", { name: "Try it on live", exact: true }).click();
  await state("idle");
  assert.equal(await page.locator(".mirror-start").getByRole("button", { name: "Start voice styling", exact: true }).isEnabled(), false);
  await page.getByRole("checkbox").last().check();
  await page.locator(".mirror-start").getByRole("button", { name: "Start voice styling", exact: true }).click();
  await state("connecting");
  assert.equal(await page.getByRole("button", { name: "Cancel", exact: true }).isVisible(), true);
  allowAnswer();
  await state("listening");
  await emit({ type: "session.output_transcript.delta", delta: "Captions alone are not playback.", start_ms: 0, end_ms: 1000 });
  await page.waitForFunction(() => window.voiceStateFixture.samples >= 3);
  assert.equal(await page.locator(".voice-state").getAttribute("data-state"), "listening");
  checks.push("transcript-does-not-imply-speaking");
  await emit({ type: "session.delegation.created", delegation: { id: "local-change" } });
  await state("thinking");
  const animation = await page.locator(".voice-state-orb > span").first().evaluate(element => getComputedStyle(element).animationName);
  assert.equal(animation, "none");
  checks.push("reduced-motion");
  await page.evaluate(() => { window.voiceStateFixture.gain.gain.value = .2; });
  await state("speaking");
  await page.locator(".voice-state").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, "desktop-speaking.png") });
  await page.evaluate(() => { window.voiceStateFixture.gain.gain.value = 0; });
  await state("thinking");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".voice-state").scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(evidence, "mobile-thinking.png") });
  await emit({ type: "decision.event", delegation_id: "local-change", event: { type: "decision.completed", decision: { answers: [] } } });
  await state("listening");
  await page.getByRole("button", { name: "Mute microphone", exact: true }).click();
  await state("muted");
  assert.equal(await page.evaluate(() => window.voiceStateFixture.peers[0].getSenders().filter(({ track }) => track?.kind === "audio").every(({ track }) => !track.enabled)), true);
  await page.getByRole("button", { name: "Unmute microphone", exact: true }).click();
  await state("listening");
  await page.getByRole("button", { name: "End voice", exact: true }).click();
  await state("idle");
  assert.equal(await page.evaluate(() => window.voiceStateFixture.peers[0].getSenders().every(({ track }) => !track || track.readyState === "ended")), true);
  checks.push("microphone-released");
  await page.locator(".mirror-start").getByRole("button", { name: "Start voice styling", exact: true }).click();
  await state("listening");
  await page.evaluate(() => window.voiceStateFixture.channel.close());
  await state("error");
  assert.equal(await page.locator(".voice-state").getAttribute("data-state"), "error");
  assert.deepEqual(errors, []);
  const result = { source: "Local loopback WebRTC; synthetic browser microphone and output audio; provider routes intercepted", checks, errors, evidence };
  writeFileSync(path.join(evidence, "verification.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  allowAnswer();
  await browser.close();
}
