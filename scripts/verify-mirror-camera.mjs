/** Real Lucy + GPT Live E2E. Only device selection is simulated; WebRTC is real.
 * LIVE_MIRROR_E2E=1 MIRROR_BASE_URL=http://localhost:3030 node scripts/verify-mirror-camera.mjs
 * Uses provider credits and synthetic camera/microphone media, never personal devices.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

assert.equal(process.env.LIVE_MIRROR_E2E, '1', 'Opt in with LIVE_MIRROR_E2E=1.');
const origin = new URL(process.env.MIRROR_BASE_URL ?? 'http://localhost:3030').origin;
const evidence = process.env.MIRROR_EVIDENCE_DIR ?? mkdtempSync(path.join(tmpdir(), 'mirror-camera-'));
mkdirSync(evidence, { recursive: true });
const camera = path.join(evidence, 'camera.y4m');
const microphone = path.join(evidence, 'silence.wav');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', 'public/costumes/cosmic-cowboy.png', '-t', '3', '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=white', '-r', '15', '-pix_fmt', 'yuv420p', camera]);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '100', microphone]);
const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${camera}`, `--use-file-for-fake-audio-capture=${microphone}`, '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['camera', 'microphone'], acceptDownloads: true, hasTouch: true });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const checks = [], errors = [];
const started = Date.now();
const log = (check, extra = {}) => { const result = { check, ms: Date.now() - started, ...extra }; checks.push(result); console.log(JSON.stringify(result)); };
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  const test = window.cameraTest = { tracks: [], peers: [], requests: [], failNext: false, holdNext: false, release: null };
  const Peer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Peer { constructor(...args) { super(...args); test.peers.push(this); } };
  const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const devices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
  navigator.mediaDevices.enumerateDevices = async () => [...await devices(), { kind: 'videoinput', deviceId: 'rear-camera', groupId: 'rear', label: 'Back camera' }];
  navigator.mediaDevices.getUserMedia = async constraints => {
    test.requests.push(constraints);
    if (!constraints.video) { const stream = await capture(constraints); test.tracks.push(...stream.getTracks()); return stream; }
    if (test.failNext) { test.failNext = false; throw new DOMException('Camera busy', 'NotReadableError'); }
    if (test.holdNext) { test.holdNext = false; await new Promise(resolve => { test.release = resolve; }); }
    const { facingMode, deviceId, ...video } = constraints.video;
    const facing = deviceId?.exact === 'rear-camera' ? 'environment' : deviceId?.exact === 'front-camera' ? 'user' : facingMode?.exact ?? facingMode?.ideal ?? 'user';
    // Chromium exposes one fake webcam. Label its native tracks as two lenses.
    const stream = await capture({ ...constraints, video });
    for (const track of stream.getVideoTracks()) {
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), facingMode: facing, deviceId: facing === 'user' ? 'front-camera' : 'rear-camera' });
    }
    test.tracks.push(...stream.getTracks());
    return stream;
  };
});
const originalFacing = () => page.locator('.mirror-original').evaluate(video => video.srcObject.getVideoTracks()[0].getSettings().facingMode);
const waitReady = () => page.waitForFunction(() => {
  const preview = document.querySelector('video[aria-label="Live costume preview"]');
  return preview?.videoWidth > 0 && preview.currentTime > 0 && !document.querySelector('.mirror-freeze')?.disabled;
}, null, { timeout: 45000 });
try {
  await page.goto(`${origin}/costumes/cosmic-cowboy`);
  await page.getByRole('tab', { name: 'Try it on', exact: true }).click();
  await page.getByRole('button', { name: 'Try it on live', exact: true }).click();
  const start = page.getByRole('button', { name: 'Start my mirror', exact: true });
  await start.waitFor();
  assert.equal(await start.isEnabled(), false);
  assert.equal(await page.evaluate(() => window.cameraTest.tracks.length), 0);
  const stage = await page.locator('.mirror-stage').boundingBox();
  const sidebar = await page.locator('.mirror-workbench').boundingBox();
  assert(stage.width > sidebar.width * 2.5);
  await page.screenshot({ path: path.join(evidence, 'desktop-ready.png') });
  log('desktop-video-primary-and-no-media-before-consent');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('#mirror-command').evaluate(input => getComputedStyle(input).fontSize), '16px');
  assert.equal(await page.locator('.mirror-conversation').isVisible(), false);
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  assert.equal(await page.locator('.mirror-conversation').isVisible(), true);
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  assert(await page.evaluate(() => document.querySelector('.mirror-body').scrollWidth <= innerWidth));
  await page.locator('.mirror-body').evaluate(body => { body.scrollTop = 0; });
  await page.screenshot({ path: path.join(evidence, 'mobile-ready.png') });
  log('mobile-input-size-and-collapsible-conversation');
  await page.getByRole('checkbox').last().check();
  await start.click();
  await waitReady();
  await page.getByRole('button', { name: 'Mute microphone', exact: true }).waitFor();
  const peers = await page.evaluate(() => window.cameraTest.peers.length);
  const initialTrack = await page.locator('.mirror-original').evaluate(video => video.srcObject.getVideoTracks()[0].id);
  const audioTrack = await page.evaluate(() => window.cameraTest.tracks.find(track => track.kind === 'audio').id);
  const outfit = await page.locator('#mirror-look').inputValue();
  assert.equal(await originalFacing(), 'user');
  assert.equal(await page.locator('.mirror-original').evaluate(video => getComputedStyle(video).transform), 'matrix(-1, 0, 0, 1, 0, 0)');
  const flip = page.getByRole('button', { name: 'Switch camera', exact: true });
  await flip.click();
  await page.waitForFunction(() => document.querySelector('.mirror-original')?.srcObject?.getVideoTracks()[0].getSettings().facingMode === 'environment');
  assert.equal(await page.locator('.mirror-original').evaluate(video => getComputedStyle(video).transform), 'none');
  assert.equal(await page.evaluate(id => window.cameraTest.tracks.find(track => track.id === id).readyState, initialTrack), 'ended');
  assert.equal(await page.evaluate(() => window.cameraTest.peers.length), peers);
  assert.equal(await page.evaluate(id => window.cameraTest.tracks.find(track => track.id === id).readyState, audioTrack), 'live');
  assert.equal(await page.locator('#mirror-look').inputValue(), outfit);
  const senderMatches = await page.evaluate(() => {
    const track = document.querySelector('.mirror-original').srcObject.getVideoTracks()[0];
    return window.cameraTest.peers.some(peer => peer.getSenders().some(sender => sender.track === track));
  });
  assert(senderMatches);
  await page.locator('.mirror-body').evaluate(body => { body.scrollTop = 0; });
  const toolbar = await page.locator('.mirror-toolbar').boundingBox();
  assert(toolbar.y + toolbar.height <= 844, 'Primary controls remain on screen.');
  await page.screenshot({ path: path.join(evidence, 'mobile-back-camera.png') });
  log('rear-camera-replaces-real-sender-without-restarting-voice-or-outfit');
  await flip.click();
  await page.waitForFunction(() => document.querySelector('.mirror-original')?.srcObject?.getVideoTracks()[0].getSettings().facingMode === 'user');
  log('front-camera-restored');
  await page.evaluate(() => { window.cameraTest.failNext = true; });
  await flip.click();
  await page.getByRole('alert').filter({ hasText: 'Your previous camera is back' }).waitFor();
  assert.equal(await originalFacing(), 'user');
  assert.equal(await page.evaluate(() => window.cameraTest.peers.length), peers);
  assert.equal(await flip.isEnabled(), true);
  log('failed-lens-switch-restores-previous-camera-on-same-connection');
  await flip.click();
  await page.waitForFunction(() => document.querySelector('.mirror-original')?.srcObject?.getVideoTracks()[0].getSettings().facingMode === 'environment');
  const statsBefore = await page.evaluate(async () => {
    for (const peer of window.cameraTest.peers) for (const item of (await peer.getStats()).values()) if (item.type === 'outbound-rtp' && item.kind === 'video') return item.framesEncoded;
  });
  await page.waitForFunction(async before => {
    for (const peer of window.cameraTest.peers) for (const item of (await peer.getStats()).values()) if (item.type === 'outbound-rtp' && item.kind === 'video' && item.framesEncoded > before + 10) return true;
    return false;
  }, statsBefore);
  log('real-webrtc-continues-sending-frames-after-switch');
  await page.setViewportSize({ width: 844, height: 390 });
  assert(await page.evaluate(() => document.querySelector('.mirror-body').scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(evidence, 'landscape-live.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.mirror-body').evaluate(body => { body.scrollTop = 0; });
  assert.equal(await page.locator('.mirror-conversation').isVisible(), true);
  await page.screenshot({ path: path.join(evidence, 'desktop-live.png') });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save this preview', exact: true }).click();
  assert((await download).suggestedFilename().endsWith('-mirror.jpg'));
  log('responsive-layout-and-preview-download');
  await page.evaluate(() => { window.cameraTest.holdNext = true; });
  await flip.click();
  await page.waitForFunction(() => typeof window.cameraTest.release === 'function');
  assert.equal(await flip.isEnabled(), false);
  assert.equal(await page.getByRole('button', { name: 'Save this preview', exact: true }).isEnabled(), false);
  await page.getByRole('button', { name: 'Close costume mirror', exact: true }).click();
  await page.evaluate(() => window.cameraTest.release());
  await page.waitForFunction(() => window.cameraTest.tracks.length >= 7 && window.cameraTest.tracks.every(track => track.readyState === 'ended') && window.cameraTest.peers.every(peer => peer.connectionState === 'closed'));
  assert.equal(await page.evaluate(() => document.documentElement.style.overscrollBehavior), '');
  log('close-during-camera-permission-releases-late-camera-and-all-media');
  assert.deepEqual(errors, []);
  log('PASS', { evidence });
} catch (error) {
  await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
  log('FAIL', { message: error.message, dialog: await page.getByRole('dialog').innerText({ timeout: 1000 }).catch(() => 'closed') });
  throw error;
} finally {
  await browser.close();
  writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ origin, checks, errors }, null, 2));
}
