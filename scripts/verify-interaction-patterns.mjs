/** Local browser verification. Uses bundled catalog data and a fixture NDJSON
 * source; it never calls a sourcing/model provider or submits checkout.
 * node scripts/verify-interaction-patterns.mjs http://localhost:3120
 */
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const upstream = new URL(process.argv[2] ?? "http://localhost:3120");
assert(["localhost", "127.0.0.1"].includes(upstream.hostname), "Run this fixture check against a local app only.");
const evidence = process.env.INTERACTION_EVIDENCE_DIR ?? await mkdtemp(path.join(tmpdir(), "costume-interactions-"));
const snapshot = JSON.parse(await readFile("data/costumes/cosmic-cowboy.json", "utf8"));
const item = {
  pieceId: "fixture-jacket", pieceName: "Fixture jacket", sizeKind: "apparel",
  productId: "fixture-jacket-product", title: "Jacket for local UI verification",
  productUrl: "https://example.invalid/jacket", image: snapshot.products[0].image,
  merchantId: "fixture-shop", merchantName: "UI fixture shop", priceCents: 3995,
  availableSizes: ["S", "M", "L"], size: null,
};
let scenario = "complete";
const server = createServer((incoming, outgoing) => {
  if (incoming.url === "/api/screenshot-costume") {
    incoming.resume();
    outgoing.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
    const send = event => { if (!outgoing.destroyed) outgoing.write(`${JSON.stringify(event)}\n`); };
    send({ t: "look", ms: 0, character: "Local UI fixture", summary: "Controlled sourcing events for browser verification.", pieces: [
      { name: item.pieceName }, { name: "Fixture boots" }, { name: "Fixture hat" },
    ] });
    const timers = [setTimeout(() => send({ t: "piece", i: 0, item, ms: 150 }), 150)];
    if (scenario === "interrupted") {
      timers.push(setTimeout(() => { send({ t: "error", text: "Fixture source interrupted. Please try again.", ms: 650 }); outgoing.end(); }, 650));
    } else {
      timers.push(setTimeout(() => send({ t: "piece", i: 1, item: { ...item, pieceId: "fixture-boots", pieceName: "Fixture boots", productId: "fixture-boots-product", title: "Boots for local UI verification", sizeKind: "one_size", availableSizes: [], priceCents: 2200 }, ms: 750 }), 750));
      timers.push(setTimeout(() => { send({ t: "miss", i: 2, ms: 1100 }); send({ t: "done", ms: 1100 }); outgoing.end(); }, 1100));
    }
    outgoing.on("close", () => timers.forEach(clearTimeout));
    return;
  }
  if (incoming.url?.startsWith("/api/") && !["GET", "HEAD"].includes(incoming.method)) {
    incoming.resume(); outgoing.writeHead(403); outgoing.end("Provider and checkout calls are disabled in this UI check."); return;
  }
  const proxy = request(new URL(incoming.url, upstream), { method: incoming.method, headers: { ...incoming.headers, host: upstream.host } }, response => {
    outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing);
  });
  proxy.on("error", error => { outgoing.writeHead(502); outgoing.end(error.message); });
  incoming.pipe(proxy);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const checks = [];
page.on("pageerror", error => errors.push(error.message));
const pass = name => { checks.push(name); console.log(`PASS ${name}`); };
const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Page has horizontal overflow");
const capture = name => page.screenshot({ path: path.join(evidence, name), animations: "disabled" });
const closeCart = () => page.getByRole("dialog", { name: "Cart", exact: true }).getByRole("button", { name: "Close", exact: true }).click();

try {
  await page.goto(`${origin}/costumes/cosmic-cowboy`);
  await page.waitForFunction(() => [...document.querySelectorAll(".costume-add")].some(button => button.offsetWidth > 0 && !button.disabled));
  await page.getByRole("button", { name: "Pieces", exact: true }).click();
  await page.locator('.carousel:visible .carousel-view[aria-pressed="true"]').filter({ hasText: "Pieces" }).waitFor();
  assert.equal(await page.locator(".carousel:visible .carousel-piece").count(), snapshot.pieces.length);
  await page.locator(".carousel:visible .carousel-piece").first().click();
  await page.locator(".piece-inspection").waitFor();
  const offeredSizes = await page.locator(".piece-inspection select option").evaluateAll(options => options.map(option => option.value).filter(Boolean));
  assert(offeredSizes.length > 1, "The bundled hat needs multiple sizes for the draft-size regression check");
  const draftSize = offeredSizes[0];
  await page.locator(".piece-inspection select").selectOption(draftSize);
  await page.locator(".piece-inspection-close").click();
  assert(await page.locator(".carousel:visible .carousel-piece").first().evaluate(element => element === document.activeElement));
  await capture("desktop-pieces.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await page.waitForFunction(() => {
    const track = [...document.querySelectorAll(".carousel-track")].find(element => element.clientWidth > 0 && element.clientHeight > 0);
    return track && Math.abs(track.scrollLeft - (track.children.length - 1) * track.clientWidth) < 2;
  });
  await capture("phone-pieces.png");
  await page.getByRole("button", { name: "Worn look", exact: true }).click();
  await page.getByRole("button", { name: /Shop pieces/ }).click();
  const hotspot = page.locator(".look-hotspot:visible").first();
  await hotspot.click();
  await page.locator(".piece-inspection").waitFor();
  assert.equal(await page.locator(".piece-inspection select").inputValue(), draftSize, "Closing inspection must retain an unadded size");
  assert.match(await page.locator(".piece-inspection").innerText(), /real products selected/);
  await capture("phone-item-inspection.png");
  await page.getByRole("button", { name: "Add costume to cart", exact: true }).click();
  const cart = page.getByRole("dialog", { name: "Cart", exact: true });
  await cart.waitFor();
  const hatLine = cart.locator(".cart-line").filter({ hasText: snapshot.pieces[0].name });
  assert.equal(await hatLine.locator(".cart-line-size").innerText(), `Size ${draftSize}`, "Whole-costume add must retain the inspector's size");
  await closeCart();
  await page.locator(".piece-inspection select").selectOption(offeredSizes[1]);
  await page.getByRole("button", { name: "View cart", exact: true }).click();
  assert.equal(await hatLine.locator(".cart-line-size").innerText(), `Size ${offeredSizes[1]}`);
  await closeCart();
  await page.locator(".piece-inspection-close").click();
  assert(await hotspot.evaluate(element => element === document.activeElement), "Inspection close must return focus to its tag");
  pass("direct gallery navigation, phone resize, shared inspection, draft-size persistence and whole-costume cart sizes");

  await page.getByRole("button", { name: "Next image", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll(".carousel-count")].some(element => element.offsetWidth > 0 && /2\s*\/\s*7/.test(element.textContent)));
  await page.getByRole("button", { name: `Change ${snapshot.pieces[0].name}`, exact: true }).click();
  const rail = page.locator(".wardrobe-rail:visible");
  await rail.waitFor();
  const choices = rail.locator('.wardrobe-rail-option:not(:disabled)');
  assert(await choices.count() > 1);
  const next = rail.locator('.wardrobe-rail-option:not(:disabled):not([aria-pressed="true"])').first();
  const nextTitle = await next.locator(".wardrobe-rail-title").innerText();
  await next.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(title => document.querySelector('.wardrobe-rail-option[aria-pressed="true"] .wardrobe-rail-title')?.textContent === title, nextTitle);
  await noOverflow();
  await capture("phone-wardrobe.png");
  await page.keyboard.press("Escape");
  assert.match(await page.locator(".carousel:visible .carousel-count").innerText(), /2\s*\/\s*7/, "A product substitution must keep the same piece close-up selected");
  await page.getByRole("button", { name: "Add costume to cart", exact: true }).click();
  await cart.waitFor();
  assert(await cart.getByRole("button", { name: /^Remove / }).count() > 0);
  assert.equal(await hatLine.locator(".cart-line-title").innerText(), nextTitle);
  const replacementSizes = snapshot.products.find(product => product.title === nextTitle)?.sizes ?? [];
  if (!replacementSizes.includes(offeredSizes[1])) assert.notEqual(await hatLine.locator(".cart-line-size").innerText(), `Size ${offeredSizes[1]}`, "An incompatible size must clear after substitution");
  await closeCart();
  pass("keyboard wardrobe choice, stable close-up, cart substitution and incompatible-size clearing at 390px");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByText("Find a lower-price outfit", { exact: true }).click();
  await page.getByRole("button", { name: "Shop for me", exact: true }).click();
  await page.locator('.shop-for-me-piece[data-state="found"]').first().waitFor();
  const partial = await page.locator('.shop-for-me-piece[data-state="found"]').count();
  assert(partial > 0 && partial < snapshot.pieces.length);
  await page.getByRole("button", { name: /Show picks now/ }).click();
  assert.equal(await page.locator('.shop-for-me-piece[data-state="found"]').count(), snapshot.pieces.length);
  assert.match(await page.locator(".shop-for-me-sequence").innerText(), /Saved sourcing replay/);
  await capture("desktop-assembly.png");
  pass("partial assembly, immediate finish, persistent result and replay disclosure");

  await page.goto(`${origin}/screenshot`);
  await page.locator('input[type="file"]').setInputFiles("public/costumes/cosmic-cowboy.png");
  await page.locator(".shot-slot.is-found").first().waitFor();
  assert(await page.locator(".shot-slot.is-looking").count() > 0, "A resolved piece must appear before other pieces finish");
  await page.getByRole("button", { name: /Inspect Fixture jacket/ }).click();
  await page.locator(".piece-inspection").waitFor();
  await page.locator(".piece-inspection select").selectOption("M");
  await page.getByRole("button", { name: "Add piece to cart", exact: true }).click();
  await cart.waitFor();
  assert.match(await cart.innerText(), /Fixture jacket/);
  await closeCart();
  await page.locator(".shot-slot.is-missing").waitFor();
  assert.equal(await page.locator(".shot-slot.is-found").count(), 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await capture("phone-screenshot-inspection.png");
  await page.reload();
  await page.getByRole("button", { name: /Inspect Fixture jacket/ }).click();
  assert.equal(await page.locator(".piece-inspection select").inputValue(), "M");
  await page.locator(".piece-inspection-close").click();
  pass("streamed results, partial inspection, size-to-cart synchronization, missing item and reload restoration");

  scenario = "interrupted";
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator('input[type="file"]').setInputFiles("public/costumes/cosmic-cowboy.png");
  await page.getByRole("alert").filter({ hasText: "Fixture source interrupted" }).waitFor();
  assert.equal(await page.locator(".shot-slot.is-found").count(), 1);
  assert.match(await page.locator(".shot-result").innerText(), /stopped|interrupted/i);
  await page.getByRole("button", { name: /Inspect Fixture jacket/ }).click();
  await noOverflow();
  await capture("phone-interrupted-sourcing.png");
  pass("interrupted sourcing preserves usable results with reduced motion");
  assert.deepEqual(errors, []);
  pass("no browser runtime errors");
} catch (error) {
  await capture("failure.png").catch(() => {});
  throw error;
} finally {
  await writeFile(path.join(evidence, "results.json"), JSON.stringify({ checks, errors, evidence }, null, 2));
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  console.log(`Evidence: ${evidence}`);
}
