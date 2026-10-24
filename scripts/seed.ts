// bun run seed [slug|path/to/snapshot.json]  (default: cosmic-cowboy)
import { resetGraph } from "../lib/graph/client";
import { loadSnapshot } from "../lib/graph/load";
import { upsertSnapshot } from "../lib/graph/upsert";

try {
  const snapshot = await loadSnapshot(process.argv[2]);
  const counts = await upsertSnapshot(snapshot);
  console.log(`Seeded "${snapshot.costume.slug}":`, counts);
} catch (e) {
  console.error("Seed failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await resetGraph();
}
