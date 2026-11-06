/** Local production checks. No checkout, inference, merchant request, or database write occurs. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Page } from "playwright";
import { costumes } from "../lib/costumes";
import { parseTelemetryEvent } from "../lib/telemetry/schema";
import snapshot from "../data/costumes/cosmic-cowboy.json";

const evidence = path.join(process.cwd(), "tmp/verification/release");
const checks: string[] = [];
const children = new Set<ChildProcess>();
const pass = (label: string) => { checks.push(label); console.log(`PASS ${label}`); };

function options() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("bun run verify:release [--url http://127.0.0.1:PORT]\nWithout --url, starts next start from the existing production build. Loopback URLs only.");
    return null;
  }
  assert(args.length === 0 || args.length === 2 && args[0] === "--url", "Expected no arguments, or --url http://127.0.0.1:PORT");
  if (!args.length) return {};
  const url = new URL(args[1]);
  assert(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Verification must target a local HTTP server");
  assert(!url.username && !url.password && url.pathname === "/" && !url.search && !url.hash, "Pass a bare local origin");
  return { url: url.origin };
}

async function localEnvironment(): Promise<NodeJS.ProcessEnv> {
  // Keep machine settings needed by Node and Chromium, without inheriting provider credentials.
  const keep = new Set(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "SYSTEMROOT", "WINDIR", "CI", "GITHUB_ACTIONS"]);
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", ...Object.fromEntries(Object.entries(process.env).filter(([key]) => keep.has(key))) };
  // Next reads dotenv files itself. Empty entries prevent those files from enabling live providers.
  for (const file of [".env.example", ".env", ".env.local", ".env.production", ".env.production.local"]) {
    try {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) env[match[1]] = "";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return { ...env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", TELEMETRY_DISABLED: "1" };
}

function launch(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, { env, stdio: "inherit" });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function runScript(file: string, base: string, env: NodeJS.ProcessEnv, args: string[] = []) {
  const child = launch(process.execPath, ["--no-env-file", file, base, ...args], env);
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(file)} failed with exit ${code}`)));
  });
  pass(path.basename(file));
}

async function unusedPort() {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
  const address = socket.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function startProduction(env: NodeJS.ProcessEnv) {
  await access(".next/BUILD_ID").catch(() => { throw new Error("No production build exists. Run bun run build first."); });
  const port = await unusedPort();
  const child = launch("node", ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], env);
  let startError: Error | undefined;
  child.once("error", (error) => { startError = error; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (startError) throw startError;
    assert(child.exitCode === null && child.signalCode === null, "Production server exited before becoming ready");
    try {
      if ((await fetch(new URL("/api/health", base), { signal: AbortSignal.timeout(1000) })).ok) return base;
    } catch { /* A listening server may still be completing startup. */ }
    await delay(250);
  }
  throw new Error("Production server did not become ready within 60 seconds");
}

async function noOverflow(page: Page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Page has horizontal overflow");
}

async function browserSmoke(base: string) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(15_000);
  const runtimeErrors: string[] = [];
  const unexpectedRequests: string[] = [];
  let validatedEventRequests = 0;
  let stage = "gallery";
  page.on("pageerror", (error) => {
    // This context has only synthetic state and public pages. Keep the first message line,
    // without stack traces or URL query values, so React error codes remain useful in CI.
    const message = error.message.split("\n")[0].replace(/https?:\/\/[^\s<>"']+/g, (value) => {
      try { const url = new URL(value); return `${url.origin}${url.pathname}`; }
      catch { return "[URL]"; }
    }).slice(0, 600);
    runtimeErrors.push(`${stage}: ${error.name}: ${message}`);
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (["data:", "blob:"].includes(url.protocol)) return route.continue();
    if (url.origin === base && url.pathname === "/api/events" && !url.search && request.method() === "POST") {
      try {
        if (parseTelemetryEvent(request.postDataJSON())) {
          validatedEventRequests++;
          return route.continue();
        }
      } catch { /* Invalid events follow the same failure path as other unexpected requests. */ }
    }
    if (url.origin !== base || !["GET", "HEAD"].includes(request.method())) {
      // Record only the method and path. Never retain payloads, tokens, or query strings.
      unexpectedRequests.push(`${request.method()} ${url.origin === base ? url.pathname : "external origin"}`);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  try {
    await page.goto(base);
    assert.equal(await page.locator("#costume-results .tile-body").count(), costumes.length);
    await page.getByRole("button", { name: "Save Cosmic Cowboy", exact: true }).click();
    await page.getByRole("button", { name: "Unsave Cosmic Cowboy", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "Unsave Cosmic Cowboy", exact: true }).waitFor();
    await page.getByRole("button", { name: /^Saved/ }).click();
    assert.equal(await page.locator("#costume-results .tile-body").count(), 1);
    await page.locator("#costume-results .tile-body").click();
    await page.waitForURL((url) => url.pathname === "/costumes/cosmic-cowboy");
    await page.getByRole("heading", { name: "Cosmic Cowboy", exact: true }).waitFor();
    pass("hydrated gallery, saved-look persistence, saved filter, and detail navigation");

    // Gallery cards may apply a completion kit. Check the full catalog separately;
    // the campaign verifier covers kit selection and owned/skipped cart agreement.
    await page.goto(new URL("/costumes/cosmic-cowboy", base).href);
    stage = "cart restoration";
    const addAll = page.getByRole("button", { name: "Add costume to cart", exact: true });
    await addAll.click();
    const cart = page.getByRole("dialog", { name: "Cart", exact: true });
    await cart.waitFor();
    assert.equal(await cart.locator(".cart-line").count(), snapshot.pieces.length);
    await cart.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await page.locator(`.cart-count[aria-label="${snapshot.pieces.length} pieces"]`).waitFor();
    await page.getByRole("button", { name: /^Cart/ }).click();
    await cart.waitFor();
    assert.equal(await cart.locator(".cart-line").count(), snapshot.pieces.length);
    await cart.getByRole("button", { name: `Remove ${snapshot.pieces[0].name}`, exact: true }).click();
    assert.equal(await cart.locator(".cart-line").count(), snapshot.pieces.length - 1);
    await cart.getByRole("button", { name: "Close", exact: true }).click();
    pass("whole-costume cart, reload restoration, and line removal");

    stage = "product replacement";
    await page.getByRole("button", { name: `Change ${snapshot.pieces[0].name}`, exact: true }).click();
    const alternative = page.locator('.wardrobe-rail:visible .wardrobe-rail-option:not(:disabled):not([aria-pressed="true"])').first();
    const nextTitle = await alternative.locator(".wardrobe-rail-title").innerText();
    await alternative.click();
    await page.keyboard.press("Escape");
    await addAll.click();
    await cart.waitFor();
    assert.equal(await cart.locator(".cart-line").count(), snapshot.pieces.length);
    assert.equal(await cart.locator(".cart-line-title").filter({ hasText: nextTitle }).count(), 1);
    await cart.getByRole("button", { name: "Close", exact: true }).click();
    await noOverflow(page);
    await page.screenshot({ path: path.join(evidence, "desktop.png"), animations: "disabled" });
    pass("product replacement reaches the cart without duplicate pieces; desktop layout fits");

    stage = "phone cart";
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    await page.getByRole("button", { name: /^Cart/ }).click();
    await cart.waitFor();
    assert.equal(await cart.locator(".cart-line").count(), snapshot.pieces.length);
    await noOverflow(page);
    await page.screenshot({ path: path.join(evidence, "phone.png"), animations: "disabled" });
    await cart.getByRole("button", { name: "Close", exact: true }).click();
    assert.deepEqual(runtimeErrors, [], `Browser threw runtime errors:\n${runtimeErrors.join("\n")}`);
    assert.deepEqual(unexpectedRequests, [], "Smoke attempted an external request, invalid event, or unsupported write");
    pass("390px phone cart and layout; no browser exceptions, provider calls, or checkout requests");
  } catch (error) {
    await page.screenshot({ path: path.join(evidence, "failure.png"), animations: "disabled" }).catch(() => {});
    throw error;
  } finally {
    await writeFile(path.join(evidence, "browser.json"), JSON.stringify({ runtimeErrors, unexpectedRequests, validatedEventRequests }, null, 2) + "\n");
    await browser.close();
  }
}

async function stopChildren() {
  for (const child of children) child.kill("SIGTERM");
  await Promise.all([...children].map((child) => new Promise<void>((resolve) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
  })));
}

async function main() {
  const config = options();
  if (!config) return;
  await mkdir(evidence, { recursive: true });
  let succeeded = false;
  try {
    const env = await localEnvironment();
    const base = config.url ?? await startProduction(env);
    const response = await fetch(new URL("/api/health", base), { signal: AbortSignal.timeout(30_000) });
    const health = await response.json();
    assert.equal(response.status, 200, "The complete bundled catalog must be available");
    assert.equal(health.catalogSource, "snapshot", "Local baseline must use the bundled catalog");
    assert.equal(health.database.configured, false, "Run baseline without live database configuration");
    assert.equal(health.coverage.shoppableCostumes, costumes.length);
    pass(`local snapshot fallback serves all ${costumes.length} costumes`);
    await runScript("scripts/verify-full-catalog.ts", base, env, ["--allow-database-down"]);
    await runScript("scripts/verify-model-gallery.ts", base, env);
    await browserSmoke(base);
    succeeded = true;
  } finally {
    await stopChildren();
    // Evidence contains public UI and check names only; no server logs, browser state, or environment data.
    await writeFile(path.join(evidence, "summary.json"), JSON.stringify({ passed: succeeded, checks, catalogCount: costumes.length }, null, 2) + "\n");
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Release verification failed"); process.exitCode = 1; });
