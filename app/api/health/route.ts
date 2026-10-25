import { connection } from "next/server";
import { readCatalogs } from "@/lib/catalog";
import { getCostume } from "@/lib/catalog/queries";
import { costumes, liveCostumeSlug } from "@/lib/costumes";
import { isDatabaseConfigured } from "@/lib/db/client";

const set = (name: string) => Boolean(process.env[name]);

export async function GET() {
  await connection();
  const started = performance.now();
  const { source, snapshots } = await readCatalogs();
  const catalogs = await Promise.all(costumes.map(async (costume) => {
    const view = await getCostume(snapshots, costume.slug);
    return {
      costumeSlug: costume.slug, source,
      pieces: view?.pieces.length ?? 0,
      products: new Set(view?.pieces.flatMap((piece) => piece.options.map((option) => option.product.id))).size,
      complete: Boolean(view?.pieces.length) && (view?.pieces.every(({ options }) => options.length === 3 &&
        options.every(({ product }) => Boolean(product.image && product.sourceImages.length))) ?? false),
      pricePointsComplete: Boolean(view?.pieces.length) && (view?.pieces.every(({ options }) =>
        options.length === 3 && new Set(options.map(({ product }) => product.priceCents)).size === 3 &&
        new Set(options.map(({ pick }) => pick.priceTier)).size === 3 && options.every(({ product }) => Boolean(product.merchantImage))) ?? false),
    };
  }));
  const missingCostumeSlugs = catalogs.filter((item) => !item.complete || !item.pricePointsComplete).map((item) => item.costumeSlug);
  const complete = catalogs.length === costumes.length && missingCostumeSlugs.length === 0;
  const ok = source === "database" && complete;
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return Response.json({
    status: ok ? "ok" : "degraded",
    buildCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    env: {
      ANTHROPIC_API_KEY: set("ANTHROPIC_API_KEY"), FIRECRAWL_API_KEY: set("FIRECRAWL_API_KEY"),
      OPENAI_API_KEY: set("OPENAI_API_KEY"),
      TURSO_DATABASE_URL: set("TURSO_DATABASE_URL"), TURSO_AUTH_TOKEN: set("TURSO_AUTH_TOKEN"),
      STRIPE_SECRET_KEY: Boolean(key), STRIPE_SECRET_KEY_IS_TEST: key.startsWith("sk_test_"), CRON_SECRET: set("CRON_SECRET"),
    },
    database: { provider: "turso", configured: isDatabaseConfigured(), ok: source === "database", latencyMs: Math.round(performance.now() - started),
      costumes: snapshots.length, products: new Set(snapshots.flatMap((s) => s.products.map((p) => p.id))).size },
    coverage: { expectedCostumes: costumes.length, shoppableCostumes: catalogs.filter((item) => item.complete && item.pricePointsComplete).length, missingCostumeSlugs },
    catalogSource: source, catalog: catalogs.find((item) => item.costumeSlug === liveCostumeSlug), catalogs,
  }, { status: complete ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
