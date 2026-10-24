import { connection } from "next/server";
import { getCatalogSource } from "@/lib/catalog";
import { getGraph, isGraphConfigured } from "@/lib/graph/client";

const set = (name: string) => Boolean(process.env[name]);

// Booleans only: never echo a value.
export async function GET() {
  await connection(); // request-time only; never prerendered under cacheComponents

  let graph = { configured: isGraphConfigured(), ok: false, latencyMs: null as number | null, costume: false };
  if (graph.configured) {
    try {
      const started = Date.now();
      const g = await Promise.race([
        getGraph().then(async (handle) => {
          await handle.roQuery("RETURN 1");
          return handle;
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3500)),
      ]);
      graph = { ...graph, ok: true, latencyMs: Date.now() - started };
      const res = await g.roQuery<{ n: number }>("MATCH (c:Costume {slug: $slug}) RETURN count(c) AS n", {
        params: { slug: "cosmic-cowboy" },
      });
      graph.costume = Number(res.data?.[0]?.n ?? 0) > 0;
    } catch {
      // leave ok=false
    }
  }

  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return Response.json(
    {
      env: {
        ANTHROPIC_API_KEY: set("ANTHROPIC_API_KEY"),
        BRIGHTDATA_API_KEY: set("BRIGHTDATA_API_KEY"),
        BRIGHTDATA_SERP_ZONE: set("BRIGHTDATA_SERP_ZONE"),
        BRIGHTDATA_UNLOCKER_ZONE: set("BRIGHTDATA_UNLOCKER_ZONE"),
        FALKORDB_URL: set("FALKORDB_URL"),
        STRIPE_SECRET_KEY: Boolean(key),
        STRIPE_SECRET_KEY_IS_TEST: key.startsWith("sk_test_"),
        CRON_SECRET: set("CRON_SECRET"),
      },
      graph,
      catalogSource: getCatalogSource() ?? (graph.ok && graph.costume ? "graph" : "snapshot"),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
