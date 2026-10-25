// Throwaway prototype: type an edit to the cowboy look, an image model applies it,
// and the changed piece is matched to real (non-big-box) products via Firecrawl.
// Run from the repo root so Bun loads .env and .env.local:  bun prototypes/edit-to-shop/server.ts
import { hostnameOf, isBlockedDomain, isNoiseDomain } from "../../lib/sourcing/blocklist";

const PORT = Number(process.env.PORT ?? 4321);
const IMAGE_MODEL = process.env.EDIT_IMAGE_MODEL ?? "gpt-image-2";
const CLAUDE_MODEL = "claude-sonnet-5-5";
const BASE_IMAGE = new URL("../../public/costumes/cosmic-cowboy.png", import.meta.url);

for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "FIRECRAWL_API_KEY"]) {
  if (!process.env[k]) throw new Error(`${k} is missing; run from the repo root so Bun loads .env.local`);
}

// Search hits are often category or search pages; only single-item pages count as a match.
const PRODUCT_PATH = /\/(listing|listings|products?|item|itm|p|dp|shop\/[^/]+\/[^/]+)\/|[?&](variant|pid)=|\/[\w-]+-p\d+|\.html?$/i;
const LISTING_PATH = /\/(market|search|c|category|categories|collections\/[^/]+\/?$|tag|shop\/?$)(\/|\?|$)/i;

type Product = { title: string; url: string; merchant: string; price?: string; image?: string };

async function editImage(prompt: string, image: Blob): Promise<string> {
  const form = new FormData();
  form.append("model", IMAGE_MODEL);
  form.append("image", image, "look.png");
  form.append("prompt", `Edit this costume photo: ${prompt}. Change only what the edit asks for; keep the pose, framing, lighting and every other garment identical, on a plain white background.`);
  form.append("size", "1024x1024");
  form.append("quality", "medium");
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  const body = await res.json() as any;
  if (!res.ok) throw new Error(`image edit failed (${res.status}): ${body?.error?.message ?? "unknown"}`);
  return `data:image/png;base64,${body.data[0].b64_json}`;
}

async function extractPiece(prompt: string, history: string[]): Promise<{ piece: string; query: string }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 300,
      system: "You turn an edit to a cowboy Halloween costume into one shoppable piece. Reply with JSON only: {\"piece\": short name of the garment or accessory that changed, \"query\": a web search query that finds that exact item for sale from small, vintage, Etsy or independent shops (no brand names of big-box stores)}.",
      messages: [{ role: "user", content: `Earlier edits: ${history.join("; ") || "none"}\nNew edit: ${prompt}` }],
    }),
  });
  const body = await res.json() as any;
  if (!res.ok) throw new Error(`Claude failed (${res.status}): ${body?.error?.message ?? "unknown"}`);
  const text: string = body.content.find((c: any) => c.type === "text")?.text ?? "";
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error(`Claude returned no JSON: ${text.slice(0, 200)}`);
  return JSON.parse(json);
}

async function firecrawl<T>(endpoint: "search" | "scrape", payload: object): Promise<T> {
  const res = await fetch(`https://api.firecrawl.dev/v2/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json() as any;
  if (!res.ok || body.success !== true) throw new Error(`Firecrawl ${endpoint} failed (${res.status})`);
  return body.data as T;
}

// Pull og:image and a price from the product page; failures just leave the card bare.
async function enrich(p: Product): Promise<Product> {
  try {
    const data = await firecrawl<{ rawHtml?: string }>("scrape", { url: p.url, formats: ["rawHtml"], onlyMainContent: false, timeout: 20_000 });
    const html = data.rawHtml ?? "";
    const meta = (prop: string) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)`, "i"))?.[1];
    const amount = meta("product:price:amount") ?? meta("og:price:amount") ?? html.match(/"price"\s*:\s*"?(\d+(?:\.\d{1,2})?)/)?.[1];
    return { ...p, image: meta("og:image") ?? p.image, price: amount ? `$${Number(amount).toFixed(2)}` : undefined };
  } catch {
    return p;
  }
}

async function findProducts(query: string): Promise<{ products: Product[]; dropped: string[] }> {
  const data = await firecrawl<{ web?: { title: string; url: string }[] }>("search", {
    query, limit: 20, country: "US", location: "San Francisco,California,United States", timeout: 25_000,
  });
  const dropped: string[] = [];
  const kept: Product[] = [];
  for (const r of data.web ?? []) {
    if (isBlockedDomain(r.url) || isNoiseDomain(r.url)) { dropped.push(hostnameOf(r.url) ?? r.url); continue; }
    const path = new URL(r.url).pathname + new URL(r.url).search;
    if (LISTING_PATH.test(path) || !PRODUCT_PATH.test(path)) { dropped.push(`${hostnameOf(r.url)} (not a product page)`); continue; }
    kept.push({ title: r.title, url: r.url, merchant: hostnameOf(r.url) ?? r.url });
  }
  return { products: await Promise.all(kept.slice(0, 3).map(enrich)), dropped };
}

async function handleEdit(req: Request): Promise<Response> {
  const { prompt, image, history = [] } = await req.json() as { prompt: string; image?: string; history?: string[] };
  if (!prompt?.trim()) return Response.json({ error: "empty edit" }, { status: 400 });
  const input = image ? await (await fetch(image)).blob() : Bun.file(BASE_IMAGE);
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);

  // The image edit and the piece -> product lookup are independent, so run them side by side.
  const [edited, shop] = await Promise.allSettled([
    editImage(prompt, input).then((url) => ({ url, ms: ms() })),
    extractPiece(prompt, history).then(async (x) => ({ ...x, ...(await findProducts(x.query)), ms: ms() })),
  ]);
  return Response.json({
    image: edited.status === "fulfilled" ? edited.value : { error: String(edited.reason) },
    shop: shop.status === "fulfilled" ? shop.value : { error: String(shop.reason) },
  });
}

Bun.serve({
  port: PORT,
  idleTimeout: 255,
  routes: {
    "/": new Response(Bun.file(new URL("./index.html", import.meta.url)), { headers: { "content-type": "text/html" } }),
    "/base.png": new Response(Bun.file(BASE_IMAGE)),
    "/edit": { POST: handleEdit },
  },
});
console.log(`edit-to-shop on http://localhost:${PORT} (image model: ${IMAGE_MODEL})`);
