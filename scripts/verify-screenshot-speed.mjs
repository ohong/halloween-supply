/** Real screenshot -> vision -> web search -> streaming board verification.
 * Uses the app's existing provider keys and a public catalog image, never personal media.
 * SCREENSHOT_EVIDENCE_DIR=/absolute/path node scripts/verify-screenshot-speed.mjs http://localhost:3031 [image.png]
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:3031';
const file = path.resolve(process.argv[3] ?? 'public/costumes/cosmic-cowboy.png');
const evidence = process.env.SCREENSHOT_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(), 'screenshot-speed-'));
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(35000);
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.screenshotSpeed = { events: [], started: 0 };
  const fetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const screenshot = String(args[0]).includes('/api/screenshot-costume');
    if (screenshot) window.screenshotSpeed.started = performance.now();
    const response = await fetch(...args);
    if (screenshot) window.screenshotSpeed.model = response.headers.get("x-vision-model");
    if (screenshot && response.body) void (async () => {
      const reader = response.clone().body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) if (line.trim()) window.screenshotSpeed.events.push({ ...JSON.parse(line), receivedMs: Math.round(performance.now() - window.screenshotSpeed.started) });
      }
    })();
    return response;
  };
});
try {
  await page.goto(`${base}/screenshot`);
  await page.locator('.shot-file').setInputFiles(file);
  await page.locator('.shot-slot:is(.is-candidate,.is-found)').first().waitFor();
  const firstPaint = await page.evaluate(() => Math.round(performance.now() - window.screenshotSpeed.started));
  assert(firstPaint < 20000, `First visible match took ${firstPaint}ms.`);
  const streaming = await page.locator('.shot-file').isDisabled();
  assert(streaming, 'The board must show its first match before the whole search ends.');
  await page.screenshot({ path: path.join(evidence, 'first-match.png'), fullPage: true, animations: 'disabled' });
  checks.push({ check: 'first-result-visible-before-search-finishes', firstPaintMs: firstPaint });
  await page.waitForFunction(() => !document.querySelector('.shot-file').disabled);
  const events = await page.evaluate(() => window.screenshotSpeed.events);
  const done = events.find(event => event.t === 'done');
  const look = events.find(event => event.t === 'look');
  assert(done && look, 'The request must complete with a shopping list.');
  assert.equal(await page.evaluate(() => window.screenshotSpeed.model), process.env.OPENAI_SCREENSHOT_MODEL ?? 'gpt-6-luna');
  assert(!events.some(event => event.t === 'error'));
  assert(done.ms <= 30500, `Server search exceeded 30 seconds: ${done.ms}ms.`);
  assert(done.receivedMs <= 33000, `The browser received completion too late: ${done.receivedMs}ms.`);
  assert(done.found > 0);
  assert.equal(await page.locator('.shot-slot:is(.is-candidate,.is-found)').count(), done.found);
  for (const link of await page.locator('.shot-slot.is-candidate a').evaluateAll(links => links.map(link => link.href))) assert(link.startsWith('https://'));
  assert.equal(await page.getByText(/No verified match/).count(), 0);
  assert.equal(await page.locator('.shot-result[aria-busy="true"]').count(), 0);
  checks.push({ check: 'bounded-real-search', visionMs: look.ms, firstMatchMs: events.find(event => event.t === 'candidate').ms, doneMs: done.ms, receivedMs: done.receivedMs, matched: done.found, priced: done.priced, requested: look.pieces.length });
  await page.screenshot({ path: path.join(evidence, 'completed-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(evidence, 'completed-mobile.png'), fullPage: true, animations: 'disabled' });
  assert.deepEqual(errors, []);
  await writeFile(path.join(evidence, 'events.json'), JSON.stringify(events, null, 2));
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify({ base, file, checks, errors }, null, 2));
  checks.forEach(check => console.log(JSON.stringify(check)));
  console.log('PASS', evidence);
} catch (error) {
  await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); }
