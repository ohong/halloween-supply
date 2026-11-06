/** Real two-browser phone media, with provider failures injected at its WebSocket boundary.
 * This verifies failure handling; verify-phone-camera.mjs verifies real provider success.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const origin = process.env.PHONE_BASE_URL ?? 'http://localhost:3026';
const output = mkdtempSync(path.join(tmpdir(), 'mirror-recovery-e2e-'));
const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 1100 }, permissions: ['camera'] });
const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, permissions: ['camera'] });
const desktop = await desktopContext.newPage(), phone = await phoneContext.newPage();
const checks = [], errors = [];
let requests = 0, sockets = 0;
let responses = [{ type: 'error', error: 'Temporary signaling failure' }, { type: 'error', error: { code: 'insufficient_credits', message: 'Insufficient account credit' } }];
const log = check => { checks.push(check); console.log(`PASS ${check}`); };
for (const page of [desktop, phone]) {
  page.setDefaultTimeout(45000);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.recoveryTest = { requests: [], peers: [], tracks: [], wakeLockRequests: 0, wakeLocks: [] };
    if (navigator.wakeLock) {
      const requestLock = navigator.wakeLock.request.bind(navigator.wakeLock);
      navigator.wakeLock.request = async (...args) => {
        window.recoveryTest.wakeLockRequests++;
        const lock = await requestLock(...args);
        window.recoveryTest.wakeLocks.push(lock);
        return lock;
      };
    }
    const Peer = RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer { constructor(...args) { super(...args); window.recoveryTest.peers.push(this); } };
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.recoveryTest.requests.push(constraints);
      const stream = await capture(constraints);
      window.recoveryTest.tracks.push(...stream.getTracks());
      return stream;
    };
  });
}
await desktop.route('**/api/live-mirror/video', async route => {
  if (route.request().method() === 'GET') await route.fulfill({ json: { videoAvailable: true, voiceAvailable: false } });
  else { requests++; await route.fulfill({ json: { token: 'failure-test-token', model: 'decart/lucy-2-5/realtime', maxSessionSeconds: null } }); }
});
await desktop.routeWebSocket(/wss:\/\/fal\.run\/decart\/lucy-2-5\//, socket => {
  sockets++;
  const response = responses.shift() ?? { type: 'error', error: 'Unexpected extra connection' };
  socket.onMessage(() => socket.send(JSON.stringify(response)));
});
const mirror = desktop.getByRole('dialog', { name: /Costume Mirror/ });
const raw = () => desktop.locator('video[aria-label="Connected phone camera, original view"]');
async function assertPhoneAlive() {
  await desktop.waitForFunction(() => {
    const video = document.querySelector('video[aria-label="Connected phone camera, original view"]');
    return video?.videoWidth > 0 && !video.paused && video.srcObject.getVideoTracks()[0].readyState === 'live';
  });
  const time = await raw().evaluate(video => video.currentTime);
  await desktop.waitForFunction(before => document.querySelector('video[aria-label="Connected phone camera, original view"]')?.currentTime > before + 0.2, time);
  assert.equal(await desktop.evaluate(() => window.recoveryTest.requests.length), 0, 'The desktop must never open its own camera.');
  assert.equal(await phone.evaluate(() => window.recoveryTest.tracks.filter(track => track.readyState === 'live').length), 1);
}
try {
  await desktop.goto(`${origin}/costumes/cosmic-cowboy`);
  await desktop.getByRole('tab', { name: 'Try it on', exact: true }).click();
  await desktop.getByRole('button', { name: 'Take photo', exact: true }).click();
  const link = desktop.getByRole('link', { name: 'Open phone camera link' });
  await link.waitFor();
  await phone.goto(await link.getAttribute('href'));
  await phone.getByRole('button', { name: 'Open camera', exact: true }).click();
  await desktop.getByText('Phone camera connected', { exact: true }).waitFor();
  assert.equal(await phone.evaluate(() => !navigator.wakeLock || window.recoveryTest.wakeLockRequests === 1), true);
  await desktop.getByRole('button', { name: 'Try it on live', exact: true }).click();
  await assertPhoneAlive();
  assert.equal(requests, 0);
  assert.equal(await mirror.getByRole('button', { name: 'Start my mirror', exact: true }).isEnabled(), false);
  log('original-phone-preview-visible-before-processing-consent');
  await mirror.getByRole('checkbox').check();
  await mirror.getByRole('button', { name: 'Start my mirror', exact: true }).click();
  await mirror.getByText(/Reconnecting costume video/).waitFor();
  await assertPhoneAlive();
  await desktop.screenshot({ path: path.join(output, 'retry-keeps-phone-preview.png') });
  await mirror.getByRole('alert').filter({ hasText: 'needs account credit' }).waitFor();
  assert.equal(requests, 2);
  assert.equal(sockets, 2);
  await assertPhoneAlive();
  log('unknown-signaling-failure-retries-and-billing-stops-with-correct-reason');

  for (const [response, expected] of [
    [{ type: 'error', error: { code: 401, message: 'Unauthorized' } }, 'rejected access'],
    [{ type: 'error', error: { code: 422, message: 'Invalid prompt' } }, 'could not accept this outfit'],
  ]) {
    responses = [response];
    const before = requests;
    await mirror.getByRole('button', { name: 'Retry my mirror', exact: true }).click();
    await mirror.getByRole('alert').filter({ hasText: expected }).waitFor();
    assert.equal(requests, before + 1);
    await assertPhoneAlive();
    log(`terminal-provider-error-does-not-retry: ${expected}`);
  }

  responses = Array.from({ length: 3 }, () => ({ type: 'error', error: { code: 429, message: 'Concurrent session limit reached' } }));
  const beforeCapacity = requests;
  await mirror.getByRole('button', { name: 'Retry my mirror', exact: true }).click();
  await mirror.getByRole('alert').filter({ hasText: 'at its session limit' }).waitFor();
  assert.equal(requests, beforeCapacity + 3);
  assert.equal(responses.length, 0);
  await assertPhoneAlive();
  log('capacity-retries-stop-after-three-attempts-with-phone-still-streaming');

  responses = [{ type: 'error', error: 'Temporary signaling failure' }];
  await mirror.getByRole('button', { name: 'Retry my mirror', exact: true }).click();
  await mirror.getByText(/Reconnecting costume video/).waitFor();
  const beforeRevoke = requests;
  await mirror.getByRole('checkbox').uncheck();
  await new Promise(resolve => setTimeout(resolve, 4500));
  assert.equal(requests, beforeRevoke);
  await assertPhoneAlive();
  log('revoking-processing-consent-cancels-retries-and-keeps-local-phone-preview');

  responses = [{ type: 'error', error: 'Temporary signaling failure' }];
  await mirror.getByRole('checkbox').check();
  await mirror.getByRole('button', { name: 'Start my mirror', exact: true }).click();
  await mirror.getByText(/Reconnecting costume video/).waitFor();
  const beforeClose = requests;
  await mirror.getByRole('button', { name: 'Use photo mode', exact: true }).click();
  await desktop.getByText('Phone camera connected', { exact: true }).waitFor();
  // Deliberate elapsed-time assertion: a canceled backoff must never open another session.
  await new Promise(resolve => setTimeout(resolve, 4500));
  assert.equal(requests, beforeClose);
  assert.equal(await desktop.evaluate(() => window.recoveryTest.peers.filter(peer => peer.connectionState === 'connected').length), 1);
  log('leaving-mirror-cancels-retry-and-retains-phone-for-photo-mode');
  await desktop.getByRole('button', { name: 'Try it on live', exact: true }).click();
  await assertPhoneAlive();
  await mirror.getByRole('button', { name: 'Close costume mirror', exact: true }).click();
  await phone.waitForFunction(() => window.recoveryTest.tracks.every(track => track.readyState === 'ended'));
  await phone.waitForFunction(() => window.recoveryTest.wakeLocks.every(lock => lock.released));
  await desktop.waitForFunction(() => window.recoveryTest.peers.every(peer => peer.connectionState === 'closed'));
  log('closing-mirror-releases-phone-and-all-peers');
  assert.deepEqual(errors, []);
} catch (error) {
  await desktop.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checks, errors, requests, sockets }, null, 2));
  console.log(output);
  await browser.close();
}
