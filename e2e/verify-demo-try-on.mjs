/** Real browser uploads and image generation. Opt in with TRY_ON_DEMO_E2E=1.
 * Four previews on one network cross the old three-request quota. Costs credits.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

assert.equal(process.env.TRY_ON_DEMO_E2E, "1", "Set TRY_ON_DEMO_E2E=1 to run four paid photo previews.");
const origin = process.env.TRY_ON_BASE_URL ?? "http://localhost:3026";
const output = mkdtempSync(path.join(tmpdir(), "demo-try-on-"));
const photo = path.resolve("public/costumes/models/cosmic-cowboy-male.webp");
const browser = await chromium.launch({ headless: true });
const checks = [], errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  if (process.env.MIRROR_ACCESS_URL) await page.goto(process.env.MIRROR_ACCESS_URL);
  for (const [index, slug] of ["cosmic-cowboy", "velvet-vampire", "moon-moth", "linen-ghost"].entries()) {
    await page.setViewportSize(index === 3 ? { width: 390, height: 844 } : { width: 1440, height: 1100 });
    await page.goto(`${origin}/costumes/${slug}`);
    await page.getByRole("tab", { name: "Try it on", exact: true }).click();
    const form = page.getByRole("region", { name: /^Try on / });
    await form.locator('input[type="file"]').first().setInputFiles(photo);
    await form.getByRole("img", { name: "Your photo", exact: true }).waitFor();
    const completed = page.waitForResponse(response => response.url().endsWith("/api/try-on") && response.request().method() === "POST", { timeout: 240000 });
    await form.getByRole("button", { name: "Try it on", exact: true }).click();
    const response = await completed;
    if (response.status() !== 200) throw new Error(`${slug}: HTTP ${response.status()} ${(await response.text()).slice(0, 300)}`);
    const preview = form.getByRole("img", { name: /AI preview/ });
    await preview.waitFor();
    await preview.evaluate(image => image.decode());
    assert.equal(await preview.evaluate(image => image.naturalWidth > 0 && image.naturalHeight > 0), true);
    assert.equal(await form.getByRole("alert").count(), 0);
    await preview.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `${slug}.png`) });
    const data = await response.json();
    writeFileSync(path.join(output, `${slug}-generated.jpg`), Buffer.from(data.image.split(",")[1], "base64"));
    await form.getByRole("button", { name: "Show original", exact: true }).click();
    await form.getByRole("img", { name: "Your photo", exact: true }).waitFor();
    await form.getByRole("button", { name: "Show preview", exact: true }).click();
    await preview.waitFor();
    checks.push({ slug, attempt: index + 1, status: 200, generated: true, originalToggle: true });
    console.log(JSON.stringify(checks.at(-1)));
  }
  assert.deepEqual(errors, []);
  writeFileSync(path.join(output, "results.json"), JSON.stringify({ checks, errors }, null, 2));
  console.log(`PASS ${output}`);
} catch (error) {
  writeFileSync(path.join(output, "failure.json"), JSON.stringify({ checks, errors, message: error.message }, null, 2));
  console.error(`FAIL ${output}`);
  throw error;
} finally { await browser.close(); }
