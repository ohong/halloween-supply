/** Real browser check against the bundled catalog. Search may use configured semantic refinement; no checkout or sourcing. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { SNAPSHOTS } from "../lib/catalog/fallback";
import { listKits, summarizeCostumes } from "../lib/kits";

const base = process.argv.find((argument) => /^https?:/.test(argument)) ?? "http://127.0.0.1:3411";
const kits = listKits(SNAPSHOTS).filter((kit) => kit.eligible);
if (process.argv.includes("--require-kits")) assert(kits.length > 0, "Researched kit records must be present");
const summaries = summarizeCostumes(SNAPSHOTS);
const kitByCostume = new Map(kits.map((kit) => [kit.costumeSlug, kit]));
const expected = summaries.map((summary) => ({
  slug: summary.costumeSlug,
  subtotal: kitByCostume.get(summary.costumeSlug)?.purchaseSubtotalCents ?? summary.fullSubtotalCents,
}));
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const output = "/tmp/halloween-discovery-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const errors: string[] = [];
const context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, reducedMotion: "reduce" });
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));

async function visibleSlugs() {
  return (await page.locator("#costume-results .tile-body").evaluateAll((links) => links.map((link) => new URL((link as HTMLAnchorElement).href).pathname.split("/").pop()))).sort();
}

async function waitForCount(count: number) {
  await page.waitForFunction((count) => document.querySelectorAll("#costume-results .tile").length === count, count);
}

async function noHorizontalOverflow(target: Page) {
  assert(await target.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "The gallery must fit the viewport");
}

async function captureGallery(filename: string) {
  await page.locator(".gallery-heading").evaluate((heading) => heading.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -76));
  // Development tools are outside the shipped page.
  await page.screenshot({ path: `${output}/${filename}.png`, style: "nextjs-portal { display: none; }" });
}

try {
  const response = await page.goto(base);
  assert.equal(response?.status(), 200);
  await waitForCount(50);
  for (const { slug, subtotal } of expected) {
    const card = page.locator(`#costume-results .tile-body[href^="/costumes/${slug}"]`);
    assert.equal(await card.count(), 1, `${slug}: preserve the catalog card`);
    const kit = kitByCostume.get(slug);
    assert.equal((await card.locator(".tile-price").innerText()).replace(/\s+/g, " "), subtotal === null ? "Price unavailable" : `${kit ? "New pieces" : "Full look from"} ${money(subtotal)}`);
    if (kit) {
      assert.equal(await card.locator(".tile-name").innerText(), kit.name, `${slug}: retain kit-specific size or style limits`);
      assert.equal(new URL(await card.getAttribute("href") ?? "", base).searchParams.get("kit"), kit.slug);
      for (const basic of kit.ownedBasics) assert((await card.innerText()).includes(basic), `${slug}: disclose each owned basic`);
      for (const supply of kit.supplies) assert((await card.innerText()).includes(supply), `${slug}: disclose each assembly supply`);
      assert((await card.innerText()).includes("Delivery unconfirmed"), `${slug}: pickup never promises delivery for the complete kit`);
      if (kit.pickupItemCount > 0) assert((await card.innerText()).includes(`Pickup listed for ${kit.pickupItemCount} of ${kit.purchaseCount} new pieces`));
    }
  }
  console.log(`PASS all 50 cards have exact listed subtotals; ${kits.length} completion kits disclose owned basics and preserve kit links`);
  await noHorizontalOverflow(page);
  await captureGallery("desktop");

  for (const limit of [5000, 10000, 20000]) {
    await page.getByRole("combobox", { name: "Price", exact: true }).selectOption(String(limit));
    const included = expected.filter(({ subtotal }) => subtotal !== null && subtotal <= limit).map(({ slug }) => slug).sort();
    await waitForCount(included.length);
    assert.deepEqual(await visibleSlugs(), included, `The $${limit / 100} filter must match each displayed subtotal`);
    assert((await page.locator("#costume-search-status").innerText()).includes(money(limit)));
  }
  console.log("PASS all three price limits filter the displayed new-piece or complete-look subtotal");

  await page.getByRole("combobox", { name: "Price", exact: true }).selectOption("");
  await waitForCount(50);
  const affordable = expected.find(({ subtotal }) => subtotal !== null && subtotal <= 10000);
  const expensive = expected.find(({ subtotal }) => subtotal !== null && subtotal > 20000);
  assert(affordable && expensive, "The real catalog needs both affordable and expensive comparison looks");
  const name = (slug: string) => SNAPSHOTS.find(({ costume }) => costume.slug === slug)!.costume.name;
  await page.getByRole("button", { name: `Save ${name(affordable.slug)}`, exact: true }).click();
  await page.getByRole("button", { name: `Save ${name(expensive.slug)}`, exact: true }).click();
  await page.getByRole("button", { name: /^Saved/ }).click();
  await waitForCount(2);
  await page.getByRole("combobox", { name: "Price", exact: true }).selectOption("10000");
  await waitForCount(1);
  assert.deepEqual(await visibleSlugs(), [affordable.slug]);
  await page.getByRole("combobox", { name: "Model", exact: true }).selectOption("male");
  assert((await page.locator("#costume-results img").first().getAttribute("alt"))?.includes("worn by our male model"));
  await page.getByRole("combobox", { name: "Price", exact: true }).selectOption("");
  await waitForCount(2);
  await page.getByRole("button", { name: "All looks", exact: true }).click();
  await waitForCount(50);
  console.log("PASS price, Saved, and model controls compose without losing saved looks");

  const search = page.getByRole("searchbox", { name: "Search costumes", exact: true });
  await search.fill(name(expensive.slug));
  await page.waitForFunction(() => !document.querySelector("#costume-search-status")?.textContent?.includes("Finding related"));
  assert((await visibleSlugs()).includes(expensive.slug), "Exact-name search must remain available");
  await page.getByRole("combobox", { name: "Price", exact: true }).selectOption("5000");
  await waitForCount(0);
  assert(await page.getByRole("heading", { name: "No looks in this price range", exact: true }).isVisible());
  await page.getByRole("button", { name: "Clear price filter", exact: true }).click();
  assert((await visibleSlugs()).includes(expensive.slug));
  await search.focus();
  await page.keyboard.press("Escape");
  await waitForCount(50);
  console.log("PASS search, empty-price recovery, and Escape-to-clear keyboard behavior");

  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page);
  await captureGallery("phone");
  await page.setViewportSize({ width: 320, height: 740 });
  await noHorizontalOverflow(page);
  await page.getByRole("button", { name: "All looks", exact: true }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "gallery-budget");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "gallery-model");
  assert.deepEqual(errors, [], "The gallery must not produce browser exceptions");
  console.log(`PASS 390px and 320px layouts fit; price and model controls are in keyboard tab order. Screenshots: ${output}`);
} finally {
  await context.close();
  await browser.close();
}
