import { connection } from "next/server";
import { FalkorDB } from "falkordb";

// Temporary preflight probe for preview deployments only (they sit behind Vercel Authentication).
// Reports env presence as booleans and fetches public pages from Vercel's network.

export const maxDuration = 60;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function timed<T>(fn: () => Promise<T>) {
  const start = Date.now();
  try { return { ok: true, ms: Date.now() - start, value: await fn() }; }
  catch (error) { return { ok: false, ms: Date.now() - start, error: String(error).slice(0, 300) }; }
}

function summarize(html: string) {
  const meta = (key: string) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i"))?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i"))?.[1];
  const ld = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim().slice(0, 3000));
  return {
    title: html.match(/<title[^>]*>([^<]*)/i)?.[1]?.trim().slice(0, 200),
    ogTitle: meta("og:title"), ogImage: meta("og:image"),
    price: meta("product:price:amount") ?? meta("og:price:amount"), currency: meta("product:price:currency"),
    jsonLd: ld.slice(0, 3),
    length: html.length,
  };
}

async function brightData(zone: string, url: string) {
  const res = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ zone, url, format: "raw" }),
    signal: AbortSignal.timeout(45000),
  });
  return { status: res.status, text: await res.text() };
}

export async function GET(request: Request) {
  await connection();
  if (process.env.VERCEL_ENV === "production") return new Response("Not found", { status: 404 });
  const params = new URL(request.url).searchParams;
  const mode = params.get("mode") ?? "env";

  if (mode === "env") {
    const names = ["ANTHROPIC_API_KEY", "BRIGHTDATA_API_KEY", "BRIGHTDATA_SERP_ZONE", "BRIGHTDATA_UNLOCKER_ZONE", "FALKORDB_URL", "STRIPE_SECRET_KEY", "CRON_SECRET"];
    const env = Object.fromEntries(names.map((name) => [name, Boolean(process.env[name])]));
    const stripeTest = process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ?? false;
    const falkor = process.env.FALKORDB_URL ? await timed(async () => {
      const db = await FalkorDB.connect({ url: process.env.FALKORDB_URL });
      try { const r = await db.selectGraph("halloween").query("RETURN 1 AS one"); return r.data; } finally { await db.close(); }
    }) : null;
    const anthropic = process.env.ANTHROPIC_API_KEY ? await timed(async () => {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", { headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" } });
      const body = await res.json() as { data?: { id: string }[] };
      return { status: res.status, ids: body.data?.map((m) => m.id) };
    }) : null;
    const stripe = process.env.STRIPE_SECRET_KEY ? await timed(async () => {
      const res = await fetch("https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } });
      return { status: res.status };
    }) : null;
    return Response.json({ vercelEnv: process.env.VERCEL_ENV, env, stripeTest, falkor, anthropic, stripe });
  }

  if (mode === "serp") {
    const q = params.get("q") ?? "silver cowboy hat";
    const shop = params.get("shop") ?? "udm";
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&brd_json=1&gl=us&hl=en${shop === "tbm" ? "&tbm=shop" : shop === "none" ? "" : "&udm=28"}`;
    const result = await timed(() => brightData(process.env.BRIGHTDATA_SERP_ZONE ?? "", url));
    if (!result.ok || !("value" in result) || !result.value) return Response.json(result);
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(result.value.text); } catch { /* not JSON */ }
    const shopping = Array.isArray(parsed.shopping) ? parsed.shopping as Record<string, unknown>[] : [];
    return Response.json({
      status: result.value.status, ms: result.ms, keys: Object.keys(parsed),
      shoppingCount: shopping.length, withPrice: shopping.filter((s) => s.price).length,
      shopping: shopping.slice(0, Number(params.get("n") ?? 8)),
      organic: Array.isArray(parsed.organic) ? (parsed.organic as Record<string, unknown>[]).slice(0, Number(params.get("n") ?? 8)).map((o) => ({ title: o.title, link: o.link })) : [],
      raw: Object.keys(parsed).length ? undefined : result.value.text.slice(0, 500),
    });
  }

  if (mode === "fetch") {
    const urls = params.getAll("url").slice(0, 8);
    const via = params.get("via") ?? "direct";
    const results = await Promise.all(urls.map(async (url) => {
      const r = await timed(async () => {
        if (via === "unlocker") {
          const res = await brightData(process.env.BRIGHTDATA_UNLOCKER_ZONE ?? "", url);
          return { status: res.status, ...summarize(res.text), json: url.endsWith(".js") || url.endsWith(".json") ? res.text.slice(0, 6000) : undefined };
        }
        const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/json" }, signal: AbortSignal.timeout(20000) });
        const text = await res.text();
        return { status: res.status, finalUrl: res.url, ...(url.endsWith(".js") || url.endsWith(".json") ? { json: text.slice(0, 6000) } : summarize(text)) };
      });
      return { url, ...r };
    }));
    return Response.json(results);
  }

  return new Response("Unknown mode", { status: 400 });
}
