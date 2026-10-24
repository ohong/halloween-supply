// bun run warm — ping the graph and restore a missing or incomplete catalog.
import { getGraph, resetGraph } from "../lib/graph/client";
import { upsertSnapshot } from "../lib/graph/upsert";
import { loadSnapshot } from "../lib/graph/load";

try {
  const snapshot = await loadSnapshot(process.argv[2]);
  const slug = snapshot.costume.slug;
  const graph = await getGraph();
  const started = performance.now();
  const found = await graph.roQuery<{ pieces: number; matches: number }>(
    `MATCH (:Costume {slug: $slug})-[:NEEDS]->(pc:Piece)
     OPTIONAL MATCH (pc)-[match:MATCHED_BY {costume: $slug}]->(:Product)
     RETURN count(DISTINCT pc) AS pieces, count(match) AS matches`,
    { params: { slug } },
  );
  console.log(`Graph answered in ${Math.round(performance.now() - started)}ms`);
  const pieces = Number(found.data?.[0]?.pieces ?? 0);
  const matches = Number(found.data?.[0]?.matches ?? 0);
  const expectedMatches = snapshot.pieces.reduce((sum, piece) => sum + piece.matches.length, 0);
  if (pieces === snapshot.pieces.length && matches === expectedMatches) {
    console.log(`Costume "${slug}" present: ${pieces} pieces, ${matches} matches.`);
  } else {
    console.log(`Costume "${slug}" missing or incomplete; re-seeding...`);
    console.log(await upsertSnapshot(snapshot));
  }
} catch (e) {
  console.error("Warm failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await resetGraph();
}
