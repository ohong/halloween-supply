/** Bounded real Lucy transport check, using Chromium's synthetic test-pattern camera.
 * MIRROR_VIDEO_E2E=1 MIRROR_BASE_URL=http://localhost:3437 node e2e/verify-mirror-video-timing.mjs
 * Uses fal/Decart credits. Does not start OpenAI voice or access personal devices.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
assert.equal(process.env.MIRROR_VIDEO_E2E, "1", "Set MIRROR_VIDEO_E2E=1 to call the real video provider.");
const origin = new URL(process.env.MIRROR_BASE_URL ?? "http://localhost:3437").origin;
const output = mkdtempSync(path.join(tmpdir(), "mirror-video-timing-"));
const browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, permissions: ["camera"] });
page.setDefaultTimeout(20_000);
const checks = [], errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.addInitScript(() => {
  window.mirrorVideoMeasurements = [];
  window.addEventListener("mirror-timing", event => window.mirrorVideoMeasurements.push(event.detail));
  window.mirrorVideoTracks = [];
  const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async constraints => {
    const stream = await capture(constraints);
    window.mirrorVideoTracks.push(...stream.getTracks());
    return stream;
  };
});
// Disable voice only in the check, because transport measurements do not need it.
await page.route("**/api/live-mirror/video", async route => {
  if (route.request().method() !== "GET") return route.continue();
  const response = await route.fetch();
  await route.fulfill({ response, json: { ...await response.json(), voiceAvailable: false } });
});
try {
  await page.goto(`${origin}/costumes/cosmic-cowboy`);
  await page.getByRole("tab", { name: "Try it on", exact: true }).click();
  await page.getByRole("button", { name: "Try it on live", exact: true }).click();
  await page.getByRole("dialog").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Start my mirror", exact: true }).click();
  const result = await page.waitForFunction(() => {
    const video = document.querySelector('video[aria-label="Live costume preview"]');
    return video?.videoWidth > 0 && video.currentTime > 0 ? { status: "decoded" }
      : document.querySelector(".mirror-error")?.textContent ? { status: "error", error: document.querySelector(".mirror-error").textContent } : false;
  }, null, { timeout: 60_000 }).then(result => result.jsonValue()).catch(() => ({ status: "timeout" }));
  checks.push(result);
  if (result.status === "decoded") {
    await page.locator(".mirror-details summary").click();
    const select = page.locator(".mirror-pieces select").first();
    const current = await select.inputValue();
    const alternative = await select.locator("option:not(:disabled)").evaluateAll((options, selected) => options.find(option => option.value !== selected)?.value, current);
    assert(alternative, "The catalog needs an alternative for the update check.");
    await select.selectOption(alternative);
    await page.waitForFunction(() => window.mirrorVideoMeasurements.filter(event => event.stage === "provider_send").length >= 1);
    assert.equal(await page.evaluate(() => window.mirrorVideoMeasurements.filter(event => event.stage === "first_frame").length), 1,
      "An outfit send must never fabricate another garment-render acknowledgement.");
    checks.push({ status: "outfit-control-sent", garmentRenderingAcknowledged: false });
  }
  const timing = await page.evaluate(() => window.mirrorVideoMeasurements);
  await page.screenshot({ path: path.join(output, "video.png") });
  await page.getByRole("button", { name: "Close costume mirror", exact: true }).click();
  await page.waitForFunction(() => window.mirrorVideoTracks.every(track => track.readyState === "ended"));
  assert.deepEqual(errors, []);
  writeFileSync(path.join(output, "timing.json"), JSON.stringify({ checks, timing, limits: "At most 60 seconds. Decoded transport frames are not garment correctness or identity proof." }, null, 2));
  console.log(JSON.stringify({ result, timing, output }));
  assert.equal(result.status, "decoded", "Real provider transport did not return decoded frames; see evidence.");
} finally { await browser.close(); }
