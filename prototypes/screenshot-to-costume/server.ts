// Throwaway prototype: drop any screenshot, Claude breaks the outfit into pieces, and
// Firecrawl sources each piece from non-big-box shops while the page streams every step.
// Run from the repo root so Bun loads .env and .env.local:  bun prototypes/screenshot-to-costume/server.ts
import { hostnameOf, isBlockedDomain, isNoiseDomain } from "../../lib/sourcing/blocklist";

const PORT = Number(process.env.PORT ?? 4322);
const CLAUDE_MODEL = "claude-sonnet-5-5";
const SAMPLES = new URL("../../public/costumes/", import.meta.url);

for (const k of ["ANTHROPIC_API_KEY", "FIRECRAWL_API_KEY"]) {
  if (!process.env[k]) throw new Error(`${k} is missing; run from the repo root so Bun loads .env.local`);
}

// Search hits are often category or search pages; only single-item pages count as a match.
const PRODUCT_PATH = /\/(listing|listings|products?|item|itm|p|dp|shop\/[^/]+\/[^/]+)\/|[?&](variant|pid)=|\/[\w-]+-p\d+|\.html?$/i;
const LISTING_PATH = /\/(market|search|c|category|categories|collections\/[^/]+\/?$|tag|shop\/?$)(\/|\?|$)/i;

type Piece = { name: string; slot: "head" | "top" | "outer" | "bottom" | "feet" | "accessory"; query: string };
type Look = { character: string; summary: string; pieces: Piece[] };
type Found = { title: string; url: string; merchant: string; priceCents: number; image: string };
type Emit = (event: Record<string, unknown>) => void;

async function decompose(dataUrl: string): Promise<Look> {
  const [, mediaType, data] = dataUrl.match(/^data:(image\/[\w+.-]+);base64,(.+)$/) ?? [];
  if (!data) throw new Error("expected a base64 image data URL");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      system: [
        "You turn a picture of a person or character into a Halloween costume built from real, separately bought clothing pieces.",
        "Reply with JSON only: {\"character\": who this is or a short evocative name for the look, \"summary\": one sentence on the look,",
        "\"pieces\": 4 to 6 items, ordered head to toe, each {\"name\": short garment name, \"slot\": one of head|top|outer|bottom|feet|accessory,",
        "\"query\": a web search query that finds that exact item for sale as a single product page on Etsy, a vintage shop or an independent brand; describe color, material and cut; never name a big-box store}}.",
        "Pick the pieces that make the look recognizable. Skip underwear, skin and hair.",
      ].join(" "),
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data } },
        { type: "text", text: "Break this look into shoppable costume pieces." },
      ] }],
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

// A candidate only counts when its page yields both an image and a price.
async function enrich(title: string, url: string): Promise<Found | null> {
  try {
    const data = await firecrawl<{ rawHtml?: string }>("scrape", { url, formats: ["rawHtml"], onlyMainContent: false, timeout: 20_000 });
    const html = data.rawHtml ?? "";
    const meta = (prop: string) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)`, "i"))?.[1];
    const amount = meta("product:price:amount") ?? meta("og:price:amount") ?? html.match(/"price"\s*:\s*"?(\d+(?:\.\d{1,2})?)/)?.[1];
    const image = meta("og:image");
    if (!image || !amount || !(Number(amount) > 0)) return null;
    return { title: meta("og:title") ?? title, url, merchant: hostnameOf(url) ?? url, priceCents: Math.round(Number(amount) * 100), image };
  } catch {
    return null;
  }
}

async function source(piece: Piece, index: number, emit: Emit): Promise<Found | null> {
  const log = (kind: string, text: string) => emit({ t: "log", index, kind, text });
  log("search", `${piece.name}: searching "${piece.query}"`);
  const data = await firecrawl<{ web?: { title: string; url: string }[] }>("search", {
    query: piece.query, limit: 12, country: "US", location: "San Francisco,California,United States", timeout: 25_000,
  });
  const candidates: { title: string; url: string }[] = [];
  for (const r of data.web ?? []) {
    const host = hostnameOf(r.url) ?? r.url;
    if (isBlockedDomain(r.url)) { log("blocked", host); continue; }
    if (isNoiseDomain(r.url)) { log("skip", `${host}, not a shop`); continue; }
    const u = new URL(r.url);
    if (LISTING_PATH.test(u.pathname + u.search) || !PRODUCT_PATH.test(u.pathname + u.search)) { log("skip", `${host}, not a product page`); continue; }
    log("candidate", `${host}`);
    candidates.push(r);
  }
  // Check the top three side by side and keep the best-ranked one that has a photo and a price.
  const checked = await Promise.all(candidates.slice(0, 3).map((c) => enrich(c.title, c.url)));
  const pick = checked.find(Boolean) ?? null;
  if (pick) log("found", `${pick.merchant}, $${(pick.priceCents / 100).toFixed(2)}`);
  else log("fail", `${piece.name}: no priced product page found`);
  return pick;
}

async function handleRun(req: Request): Promise<Response> {
  const { image } = await req.json() as { image?: string };
  if (!image) return Response.json({ error: "no image" }, { status: 400 });
  const encoder = new TextEncoder();
  const t0 = performance.now();
  const stream = new ReadableStream({
    async start(controller) {
      const emit: Emit = (e) => controller.enqueue(encoder.encode(JSON.stringify({ ...e, ms: Math.round(performance.now() - t0) }) + "\n"));
      try {
        emit({ t: "log", kind: "think", text: "Reading the look…" });
        const look = await decompose(image);
        emit({ t: "look", ...look });
        await Promise.all(look.pieces.map(async (piece, index) => {
          const product = await source(piece, index, emit).catch((err) => {
            emit({ t: "log", index, kind: "fail", text: `${piece.name}: ${String(err.message ?? err)}` });
            return null;
          });
          emit({ t: "piece", index, product });
        }));
        emit({ t: "done" });
      } catch (err) {
        emit({ t: "error", text: String((err as Error).message ?? err) });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

Bun.serve({
  port: PORT,
  idleTimeout: 255,
  routes: {
    "/": new Response(Bun.file(new URL("./index.html", import.meta.url)), { headers: { "content-type": "text/html" } }),
    "/samples/:name": (req) => new Response(Bun.file(new URL(req.params.name.replace(/[^\w.-]/g, ""), SAMPLES))),
    "/run": { POST: handleRun },
  },
});
console.log(`screenshot-to-costume on http://localhost:${PORT}`);
