/** Real browser + command provider checks. No personal media devices are opened.
 * MIRROR_COMMAND_E2E=1 MIRROR_BASE_URL=http://localhost:3437 node e2e/verify-mirror-commands.mjs
 * Six bounded text requests use existing OpenAI credentials. Video is not started.
 * MIRROR_COMMAND_FIXTURE=1 verifies downstream browser state using intercepted command responses.
 * Fixture measurements are not provider latency evidence.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const fixture = process.env.MIRROR_COMMAND_FIXTURE === "1";
assert(fixture || process.env.MIRROR_COMMAND_E2E === "1", "Set MIRROR_COMMAND_E2E=1 for real provider usage, or MIRROR_COMMAND_FIXTURE=1 for state-only fixtures.");
const origin = new URL(process.env.MIRROR_BASE_URL ?? "http://localhost:3437").origin;
const output = process.env.MIRROR_EVIDENCE_DIR ?? mkdtempSync(path.join(tmpdir(), "mirror-commands-"));
const browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(45_000);
const checks = [], errors = [];
const log = (check, extra = {}) => { checks.push({ check, ...extra }); console.log(JSON.stringify(checks.at(-1))); };
page.on("pageerror", error => errors.push(error.message));
if (fixture) await page.addInitScript(() => {
  class Channel extends EventTarget {
    readyState = "open";
    send(data) {
      const event = JSON.parse(data);
      window.voiceFixture.sent.push(event.type);
      if (event.type === "session.close") setTimeout(() => this.receive({ type: "session.closed" }), 0);
    }
    receive(data) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) })); }
    close() { this.readyState = "closed"; }
  }
  window.voiceFixture = { sent: [], emit: event => window.voiceFixture.channel.receive(event) };
  window.RTCPeerConnection = class extends EventTarget {
    iceGatheringState = "complete";
    connectionState = "connected";
    createDataChannel() { return window.voiceFixture.channel = new Channel(); }
    addTrack() {}
    createOffer() { return { type: "offer", sdp: "synthetic-voice-transport" }; }
    setLocalDescription(description) { this.localDescription = description; }
    setRemoteDescription() { setTimeout(() => window.voiceFixture.emit({ type: "session.started" }), 0); }
    getReceivers() { return []; }
    close() { this.connectionState = "closed"; }
  };
});
await page.addInitScript(() => {
  window.mirrorMeasurements = [];
  window.addEventListener("mirror-timing", event => window.mirrorMeasurements.push(event.detail));
  window.captureAttempts = 0;
  const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (...args) => { window.captureAttempts++; return capture(...args); };
});
const selected = () => page.locator(".mirror-pieces select").evaluateAll(elements => Object.fromEntries(elements.map(element => [element.id.replace("mirror-piece-", ""), element.value])));
const type = async text => {
  await page.getByLabel("Tell us how to change your look").fill(text);
  const response = page.waitForResponse(response => response.url().endsWith("/api/live-mirror/command") && response.request().method() === "POST");
  const startedAt = performance.now();
  await page.getByRole("button", { name: "Send styling request", exact: true }).click();
  const completed = await response;
  const command = await completed.json();
  assert.equal(completed.status(), 200, JSON.stringify(command));
  await page.getByRole("button", { name: "Send styling request", exact: true }).waitFor();
  return { command, intentMs: Math.round(performance.now() - startedAt) };
};
try {
  await page.goto(`${origin}/costumes/cosmic-cowboy`);
  await page.getByRole("tab", { name: "Try it on", exact: true }).click();
  await page.getByRole("button", { name: "Try it on live", exact: true }).click();
  await page.locator(".mirror-details summary").click();
  const view = await (await page.request.get(`${origin}/api/live-mirror/catalog?slug=cosmic-cowboy`)).json();
  const jacket = view.pieces.find(({ piece }) => /jacket/i.test(piece.name));
  let fixtureHandler;
  if (fixture) {
    fixtureHandler = async route => {
      const { text } = route.request().postDataJSON();
      const actions = /cheapest/i.test(text) ? [{ type: "select", pieceId: jacket.piece.id, productId: available[0].product.id }]
        : /already own/i.test(text) ? [{ type: "use", pieceId: jacket.piece.id, use: "owned" }]
        : /undo/i.test(text) ? [{ type: "undo" }]
        : /full Velvet Vampire/i.test(text) ? [{ type: "try_look", costumeSlug: "velvet-vampire" }]
        : [{ type: "appearance", pieceId: jacket.piece.id, color: /red/i.test(text) ? "red" : "bright blue", style: null }];
      await route.fulfill({ json: { actions } });
    };
    await page.route("**/api/live-mirror/command", fixtureHandler);
  }
  const available = jacket.options.filter(({ product }) => product.availability !== "out_of_stock").sort((a, b) => a.product.priceCents - b.product.priceCents);
  assert(available.at(-1).product.priceCents > available[0].product.priceCents);
  await page.locator(`#mirror-piece-${jacket.piece.id}`).selectOption(available.at(-1).product.id);
  const before = await selected();
  const cheap = await type(`Choose the cheapest ${jacket.piece.name}. Keep every other piece unchanged.`);
  await page.waitForFunction(({ id, expected }) => document.getElementById(`mirror-piece-${id}`).value === expected, { id: jacket.piece.id, expected: available[0].product.id });
  assert.deepEqual(await selected(), { ...before, [jacket.piece.id]: available[0].product.id });
  assert(cheap.command.actions.every(action => action.type !== "cheapest" && action.type !== "try_look"));
  log("cheaper-jacket-preserves-other-pieces", { intentMs: cheap.intentMs });

  const baseline = await selected();
  const color = await type(`Make the ${jacket.piece.name} bright blue in the preview. Keep the same products.`);
  await page.waitForFunction(() => /bright blue/i.test(document.querySelector(".mirror-preview-edits").textContent));
  assert.deepEqual(await selected(), baseline);
  assert(color.command.actions.some(action => action.type === "appearance" && action.pieceId === jacket.piece.id));
  log("preview-color-preserves-purchasable-products", { intentMs: color.intentMs });

  const owned = await type(`I already own the ${jacket.piece.name}. Keep every other piece unchanged.`);
  await page.getByText("Already owned", { exact: false }).waitFor();
  assert.equal((await page.locator(".mirror-preview-edits").innerText()).includes("bright blue"), false);
  assert(owned.command.actions.some(action => action.type === "use" && action.pieceId === jacket.piece.id && action.use === "owned"));
  log("owned-piece-keeps-other-slots-and-clears-old-preview-override", { intentMs: owned.intentMs });

  const undo = await type("Undo my last outfit change.");
  assert.deepEqual(undo.command.actions, [{ type: "undo" }]);
  await page.waitForFunction(() => /bright blue/i.test(document.querySelector(".mirror-preview-edits").textContent));
  assert.deepEqual(await selected(), baseline);
  log("undo-restores-complete-previous-snapshot", { intentMs: undo.intentMs });

  const change = await type("Try the full Velvet Vampire costume. Keep the budget unchanged.");
  await page.waitForFunction(() => document.getElementById("mirror-look").value === "velvet-vampire");
  assert.equal(change.command.catalogResults, undefined);
  assert.deepEqual(change.command.actions.map(action => action.type), ["try_look"]);
  await page.getByRole("button", { name: "Undo last outfit change", exact: true }).click();
  await page.waitForFunction(() => document.getElementById("mirror-look").value === "cosmic-cowboy");
  assert.deepEqual(await selected(), baseline);
  await page.waitForFunction(() => /bright blue/i.test(document.querySelector(".mirror-preview-edits").textContent));
  log("full-look-switch-skips-old-look-search-and-undo-restores-color", { intentMs: change.intentMs });

  // Delay a real provider response, then edit manually while it is in flight.
  let releaseResponse, ready;
  const released = new Promise(resolve => { releaseResponse = resolve; });
  const responseReady = new Promise(resolve => { ready = resolve; });
  await page.route("**/api/live-mirror/command", async route => {
    const response = fixture ? undefined : await route.fetch();
    ready();
    await released;
    await route.fulfill(response ? { response } : { json: { actions: [{ type: "appearance", pieceId: jacket.piece.id, color: "red", style: null }] } });
  }, { times: 1 });
  await page.getByLabel("Tell us how to change your look").fill(`Make the ${jacket.piece.name} red in the preview.`);
  await page.getByRole("button", { name: "Send styling request", exact: true }).click();
  await responseReady;
  await page.locator(`#mirror-piece-${jacket.piece.id}`).selectOption(available.at(-1).product.id);
  releaseResponse();
  await page.getByText("Your look changed while that request was running. Please try it again.", { exact: true }).waitFor();
  assert.equal((await page.locator(".mirror-preview-edits").innerText()).includes("red"), false);
  assert.equal((await selected())[jacket.piece.id], available.at(-1).product.id);
  log("interrupted-response-cannot-overwrite-newer-manual-state");
  assert.equal(await page.evaluate(() => window.captureAttempts), 0);
  if (fixture) {
    const catalog = await (await page.request.get(`${origin}/api/live-mirror/catalog`)).json();
    await page.route("**/api/live-mirror/voice", route => route.fulfill({ json: { transport: { sdp: "synthetic-answer" }, catalog: catalog.looks, maxSessionSeconds: null } }));
    await page.getByRole("dialog").getByRole("checkbox").check();
    await page.getByRole("button", { name: "Start voice styling", exact: true }).click();
    await page.getByText("Listening", { exact: true }).waitFor();
    let releasePreview, previewReady;
    const previewReleased = new Promise(resolve => { releasePreview = resolve; });
    const pendingPreview = new Promise(resolve => { previewReady = resolve; });
    await page.route("**/api/live-mirror/command", async route => {
      previewReady();
      await previewReleased;
      await route.fulfill({ json: { actions: [{ type: "appearance", pieceId: jacket.piece.id, color: "red", style: null }] } }).catch(() => {});
    }, { times: 1 });
    await page.evaluate(() => {
      window.voiceFixture.emit({ type: "session.input_transcript.delta", delta: "Make the jacket red.", start_ms: 0, end_ms: 500 });
      window.voiceFixture.emit({ type: "session.delegation.created", delegation: { id: "older" } });
      window.voiceFixture.emit({ type: "decision.event", delegation_id: "older", event: { type: "decision.completed", decision: { answers: [{ type: "choice", name: "preview_edit", choice: "yes", confidence: 1 }] } } });
    });
    await pendingPreview;
    await page.evaluate(() => window.voiceFixture.emit({ type: "session.input_transcript.delta", delta: "Wait, choose the cheaper jacket instead.", start_ms: 700, end_ms: 1200 }));
    releasePreview();
    const jacketIndex = view.pieces.findIndex(({ piece }) => piece.id === jacket.piece.id);
    await page.evaluate(({ index, product }) => {
      window.voiceFixture.emit({ type: "session.delegation.created", delegation: { id: "newer" } });
      window.voiceFixture.emit({ type: "decision.event", delegation_id: "newer", event: { type: "decision.completed", decision: { answers: [{ type: "choice", name: `piece_${index}`, choice: product, confidence: 1 }] } } });
    }, { index: jacketIndex, product: available[0].product.id });
    await page.waitForFunction(({ id, expected }) => document.getElementById(`mirror-piece-${id}`).value === expected, { id: jacket.piece.id, expected: available[0].product.id });
    assert.equal((await page.locator(".mirror-preview-edits").innerText()).includes("red"), false);
    await page.getByRole("button", { name: "End voice", exact: true }).click();
    log("spoken-correction-aborts-older-delegation-before-new-state-commit");
  }
  const timing = await page.evaluate(() => window.mirrorMeasurements);
  assert(timing.some(item => item.stage === "parse"));
  assert(timing.some(item => item.stage === "state_applied"));
  assert.equal(timing.some(item => ["provider_connect", "provider_send", "first_frame"].includes(item.stage)), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, "commands.png") });
  writeFileSync(path.join(output, "commands.json"), JSON.stringify({ checks, timing, mode: fixture ? "fixture" : "provider", limits: "No video provider or voice transport was started. Fixture timing measures local state plumbing only; command timing is not rendered garment latency." }, null, 2));
  console.log(`PASS ${checks.length} ${fixture ? "fixture" : "real provider"} runtime command checks. Evidence: ${output}`);
} finally { await browser.close(); }
