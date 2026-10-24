import { connection } from "next/server";
import { getCatalogSource, getCostume } from "@/lib/catalog";
import { liveCostumeSlug } from "@/lib/costumes";
import { getGraph, isGraphConfigured, resetGraph } from "@/lib/graph/client";

const set = (name: string) => Boolean(process.env[name]);

// Booleans only: never echo a value.
export async function GET() {
  await connection();

  const catalogPromise = getCostume(liveCostumeSlug).then((view) => ({
    source: getCatalogSource(),
    pieces: view?.pieces.length ?? 0,
    products: new Set(view?.pieces.flatMap((piece) => piece.options.map((option) => option.product.id))).size,
    complete: Boolean(view?.pieces.length) && (view?.pieces.every((piece) =>
      piece.options.length >= 3 && piece.options.some((option) =>
        option.pick.rank === 0 && option.product.availability === "in_stock",
      ),
    ) ?? false),
  }));

  const graph = { configured: isGraphConfigured(), ok: false, latencyMs: null as number | null, costume: false, pieces: 0, products: 0 };
  const graphPromise = (async () => {
    if (!graph.configured) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const started = Date.now();
      const result = await Promise.race([
        getGraph().then((handle) => handle.roQuery<{ costumes: number; pieces: number; products: number }>(
          `MATCH (c:Costume {slug: $slug})
           OPTIONAL MATCH (c)-[:NEEDS]->(piece:Piece)
           OPTIONAL MATCH (piece)-[match:MATCHED_BY]->(product:Product)
           WHERE match.costume = $slug
           RETURN count(DISTINCT c) AS costumes, count(DISTINCT piece) AS pieces, count(DISTINCT product) AS products`,
          { params: { slug: liveCostumeSlug } },
        )),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Health check timed out")), 3500);
        }),
      ]);
      graph.ok = true;
      graph.latencyMs = Date.now() - started;
      graph.costume = Number(result.data?.[0]?.costumes ?? 0) > 0;
      graph.pieces = Number(result.data?.[0]?.pieces ?? 0);
      graph.products = Number(result.data?.[0]?.products ?? 0);
    } catch {
      void resetGraph();
    } finally {
      clearTimeout(timer);
    }
  })();
  const [catalog] = await Promise.all([catalogPromise, graphPromise]);

  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return Response.json(
    {
      status: graph.ok && catalog.source === "graph" && catalog.complete ? "ok" : "degraded",
      buildCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
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
      catalogSource: catalog.source,
      catalog: { costumeSlug: liveCostumeSlug, ...catalog },
    },
    { status: catalog.complete ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
