/** Exercise the running HTTP server; pass a deployment URL to check public behavior. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const base = new URL(process.argv[2] ?? "http://localhost:3100");
const checks: string[] = [];
function check(condition: unknown, label: string): asserts condition {
  assert(condition, label);
  checks.push(label);
}
async function get(path: string, accept?: string, method = "GET") {
  const response = await fetch(new URL(path, base), { headers: accept ? { Accept: accept } : {}, method, signal: AbortSignal.timeout(30_000) });
  return { response, body: await response.text() };
}
function varies(response: Response) {
  return response.headers.get("vary")?.toLowerCase().split(/\s*,\s*/).includes("accept");
}
function plain(html: string) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

const negotiated = [
  ["text/markdown", "text/markdown"],
  ["text/html", "text/html"],
  ["text/markdown;q=0.2,text/html;q=0.9", "text/html"],
  ["text/html;q=0.2,text/markdown;q=0.9", "text/markdown"],
  ["text/markdown;q=0,text/html;q=1", "text/html"],
  ["text/html;q=0,text/markdown;q=1", "text/markdown"],
  ["text/*;q=0.8,text/markdown;q=0", "text/html"],
  ["text/*;q=0.8,text/html;q=0", "text/markdown"],
  ["text/markdown,text/html", "text/markdown"],
  ["text/html,text/markdown", "text/html"],
  ["*/*", "text/html"],
  ["text/markdown; charset=utf-8", "text/markdown"],
  ["TEXT/MARKDOWN", "text/markdown"],
];
for (const [accept, contentType] of negotiated) {
  const { response, body } = await get("/", accept);
  check(response.status === 200 && response.headers.get("content-type")?.startsWith(contentType) && body.length > 500 && (contentType !== "text/markdown" || varies(response)), `negotiation: ${accept}`);
}
for (const accept of ["application/json", "text/html;q=0,text/markdown;q=0", "*/*;q=0", "text/markdown;q=invalid", "text/markdown;variant=unsupported"]) {
  const { response, body } = await get("/", accept);
  check(response.status === 406 && varies(response) && body.includes("text/markdown"), `unsupported representation: ${accept}`);
}
for (const path of ["/__agent-readiness-missing", "/costumes/not-a-real-costume", "/constructor", "/__proto__"]) {
  const { response, body } = await get(path, "text/markdown");
  check(response.status === 404 && response.headers.get("content-type")?.startsWith("text/markdown") && varies(response) && body.length > 20 && body.includes("/llms.txt"), `Markdown 404: ${path}`);
}
const missingHtml = await get("/__agent-readiness-missing", "text/html");
check(missingHtml.response.status === 404 && missingHtml.response.headers.get("content-type")?.startsWith("text/html"), "HTML 404 remains 404");
const head = await get("/", "text/markdown", "HEAD");
check(head.response.status === 200 && head.body === "" && head.response.headers.get("content-type")?.startsWith("text/markdown") && varies(head.response), "HEAD retains Markdown headers without a body");
const wildcard = await get("/");
check(wildcard.response.status === 200 && wildcard.response.headers.get("content-type")?.startsWith("text/html"), "default requests receive HTML");
const rsc = await fetch(new URL("/", base), { headers: { Accept: "text/x-component", RSC: "1" } });
check(rsc.status === 200, "framework navigation bypasses public document negotiation");
const icon = await get("/icon.svg", "text/markdown");
check(icon.response.status === 200 && icon.response.headers.get("content-type")?.includes("image/svg+xml"), "static asset bypasses document negotiation");
const api = await get("/api/health", "text/markdown");
check(api.response.status === 200 && api.response.headers.get("content-type")?.includes("application/json"), "API preserves its JSON response");

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const navigation = await page.goto(base.href);
  check(navigation?.status() === 200, "homepage loads without JavaScript");
  const identity = await page.evaluate(() => {
    const schemas = [...document.querySelectorAll('script[type="application/ld+json"]')].map((node) => JSON.parse(node.textContent ?? "{}"));
    return {
      title: document.title,
      lang: document.documentElement.lang,
      h1: document.querySelector("h1")?.textContent,
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
      image: document.querySelector('meta[property="og:image"]')?.getAttribute("content"),
      type: document.querySelector('meta[property="og:type"]')?.getAttribute("content"),
      schemas,
      guideCount: document.querySelectorAll(".costume-guide-list > li").length,
      guideText: document.querySelector(".costume-guide-directory")?.textContent,
      headings: [...document.querySelectorAll("main h1, main h2, main h3, main h4, main h5, main h6")].map((heading) => Number(heading.tagName.slice(1))),
    };
  });
  check(identity.title.includes("Halloween Supply") && /costume ideas/i.test(identity.title), "title names brand and core product");
  check(identity.lang === "en" && Boolean(identity.h1) && new URL(identity.canonical ?? base).href === "https://halloween.supply/" && identity.type === "website" && Boolean(identity.image), "homepage identity metadata is complete");
  const graphs = identity.schemas.flatMap((schema) => schema["@graph"] ?? [schema]);
  const organization = graphs.find((schema) => schema["@type"] === "Organization");
  check(organization?.name === "Halloween Supply" && organization.url === "https://halloween.supply" && organization.contactPoint.contactType === "customer support", "Organization schema is valid JSON and has verified identity");
  check(graphs.some((schema) => schema["@type"] === "WebSite" && schema.publisher["@id"] === organization["@id"]), "WebSite schema references the organization");
  check(identity.guideCount === 50 && (identity.guideText?.length ?? 0) > 500, "all 50 guides are server-rendered");
  check(identity.headings[0] === 1 && identity.headings.every((level, index) => index === 0 || level <= identity.headings[index - 1] + 1), "homepage heading levels are sequential");
  await page.locator(".costume-guide-directory summary").click();
  check(await page.locator("#costume-guide-title").isVisible(), "native guide disclosure works without JavaScript");
  const meaningfulCharacters = plain(wildcard.body).length;
  const ratio = meaningfulCharacters / wildcard.body.length;
  check(meaningfulCharacters >= 500 && ratio >= 0.05, "raw HTML has at least 500 characters and 5% meaningful text");
  const imageUrl = new URL(identity.image!, base);
  const og = await fetch(new URL(imageUrl.pathname + imageUrl.search, base));
  check(og.status === 200 && og.headers.get("content-type")?.startsWith("image/") && (await og.arrayBuffer()).byteLength > 1000, "Open Graph image is accessible");

  for (const path of ["/about", "/contact", "/privacy"]) {
    const html = await get(path, "text/html");
    const md = await get(path, "text/markdown");
    check(html.response.status === 200 && plain(html.body).length > 500 && md.response.status === 200 && md.body.startsWith("# ") && md.body.length > 500 && varies(md.response), `trust page and Markdown: ${path}`);
    await page.goto(new URL(path, base).href);
    check(await page.locator("main h1").count() === 1 && await page.locator(`link[rel="canonical"][href="https://halloween.supply${path}"]`).count() === 1, `trust page heading and canonical: ${path}`);
  }
  const llms = await get("/llms.txt");
  check(llms.response.status === 200 && llms.response.headers.get("content-type")?.startsWith("text/plain") && /^# Halloween Supply\n\n> /m.test(llms.body) && llms.body.includes("## When to use this") && /- \[[^\]]+\]\(https:\/\/halloween\.supply/.test(llms.body) && llms.body.includes("Accept: text/markdown"), "llms.txt follows the published Markdown structure and gives invocation guidance");
  const robots = await get("/robots.txt");
  check(robots.response.status === 200 && robots.body.includes("User-Agent: *") && robots.body.includes("Sitemap: https://halloween.supply/sitemap.xml") && robots.body.includes("Disallow: /api/"), "robots.txt advertises sitemap and excludes private workflows");
  const sitemap = await get("/sitemap.xml");
  const entries = await page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror") || doc.documentElement.namespaceURI !== "http://www.sitemaps.org/schemas/sitemap/0.9") throw new Error("Invalid sitemap XML");
    return [...doc.querySelectorAll("url")].map((node) => ({ url: node.querySelector("loc")?.textContent ?? "", modified: node.querySelector("lastmod")?.textContent ?? "" }));
  }, sitemap.body);
  check(sitemap.response.status === 200 && sitemap.response.headers.get("content-type")?.includes("xml") && entries.length === 55 && new Set(entries.map((entry) => entry.url)).size === 55 && entries.every(({ url, modified }) => url.startsWith("https://halloween.supply/") && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(modified)) && sitemap.body.length < 50_000_000, "sitemap is valid XML with 55 canonical URLs and lastmod dates");
  let checked = 0;
  for (let offset = 0; offset < entries.length; offset += 5) {
    await Promise.all(entries.slice(offset, offset + 5).map(async ({ url }) => {
      const path = new URL(url).pathname;
      const html = await get(path, "text/html");
      const md = await get(path, "text/markdown");
      check(html.response.status === 200 && md.response.status === 200 && md.response.headers.get("content-type")?.startsWith("text/markdown") && md.body.startsWith("# "), `public HTML and Markdown: ${path}`);
      checked++;
    }));
  }
  const interactive = await browser.newContext();
  const shopper = await interactive.newPage();
  await shopper.goto(base.href);
  await shopper.getByRole("link", { name: "View Cosmic Cowboy", exact: true }).click();
  await shopper.waitForURL("**/costumes/cosmic-cowboy");
  await shopper.getByRole("heading", { name: "Cosmic Cowboy", exact: true }).waitFor();
  check(await shopper.getByRole("heading", { name: "Cosmic Cowboy", exact: true }).isVisible(), "hydrated gallery navigation still opens the costume");
  await shopper.getByRole("link", { name: "Privacy", exact: true }).click();
  await shopper.waitForURL("**/privacy");
  await shopper.getByRole("heading", { name: "Privacy at Halloween Supply", exact: true }).waitFor();
  check(await shopper.getByRole("heading", { name: "Privacy at Halloween Supply", exact: true }).isVisible(), "hydrated footer navigation opens the trust page");
  const result = { base: base.href, verifiedAt: new Date().toISOString(), checks: checks.length, publicPages: checked, meaningfulCharacters, htmlCharacters: wildcard.body.length, contentRatio: ratio, result: "passed", details: checks };
  if (process.env.AGENT_VERIFICATION_OUTPUT) await writeFile(process.env.AGENT_VERIFICATION_OUTPUT, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ ...result, details: undefined }, null, 2));
} finally { await browser.close(); }
