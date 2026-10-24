// bun run warm — ping the graph and re-seed if the free tier wiped it.
import { getGraph, resetGraph } from "../lib/graph/client";
import { upsertSnapshot } from "../lib/graph/upsert";
import { loadSnapshot } from "../lib/graph/load";

const SLUG = "cosmic-cowboy";

try {
  const graph = await getGraph();
  const started = Date.now();
  await graph.query("RETURN 1");
  console.log(`graph answered in ${Date.now() - started}ms`);
  const found = await graph.roQuery<{ n: number }>("MATCH (c:Costume {slug: $slug}) RETURN count(c) AS n", {
    params: { slug: SLUG },
  });
  if (Number(found.data?.[0]?.n ?? 0) > 0) {
    console.log(`Costume "${SLUG}" present; nothing to seed.`);
  } else {
    console.log(`Costume "${SLUG}" missing; re-seeding...`);
    console.log(await upsertSnapshot(await loadSnapshot(SLUG)));
  }
} catch (e) {
  console.error("Warm failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await resetGraph();
}
