import { connection } from "next/server";
import { getCatalogSource, getCostume } from "@/lib/catalog";
import { costumes, liveCostumeSlug } from "@/lib/costumes";
import { getGraph, isGraphConfigured, resetGraph } from "@/lib/graph/client";

const set = (name: string) => Boolean(process.env[name]);

// Booleans only: never echo a value.
export async function GET() {
  await connection();

  // Resolve in sequence so the source belongs to this exact catalog read.
  const catalogPromise = (async () => {
    const catalogs = [];
    for (const costume of costumes.filter((item) => item.status === "live")) {
      const view = await getCostume(costume.slug);
      catalogs.push({
        costumeSlug: costume.slug,
        source: getCatalogSource(),
        pieces: view?.pieces.length ?? 0,
        products: new Set(view?.pieces.flatMap((piece) => piece.options.map((option) => option.product.id))).size,
        complete: view?.pieces.length === 5 && view.pieces.every(({ options }) =>
          options.length === 3 && options.some(({ pick, product }) =>
            pick.rank === 0 && product.availability === "in_stock" && Boolean(product.cutout),
          ),
        ),
      });
    }
    return catalogs;
  })();

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
  const [catalogs] = await Promise.all([catalogPromise, graphPromise]);
  const catalog = catalogs.find((item) => item.costumeSlug === liveCostumeSlug);
  const complete = catalogs.length > 0 && catalogs.every((item) => item.complete);

  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return Response.json(
    {
      status: graph.ok && catalogs.every((item) => item.source === "graph") && complete ? "ok" : "degraded",
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
      catalogSource: catalogs.every((item) => item.source === "graph") ? "graph" : "snapshot",
      catalog,
      catalogs,
    },
    { status: complete ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
