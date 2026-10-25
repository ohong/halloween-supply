// bun run seed [slug|path/to/snapshot.json|--all]
import { readdir } from "node:fs/promises";
import { loadSnapshot } from "../lib/catalog/load";
import { ensureSchema, upsertSnapshot } from "../lib/db/catalog";

try {
  await ensureSchema();
  const inputs = process.argv.includes("--all")
    ? (await readdir("data/costumes")).filter((file) => file.endsWith(".json")).map((file) => `data/costumes/${file}`)
    : [process.argv[2]];
  for (const input of inputs) {
    const snapshot = await loadSnapshot(input);
    await upsertSnapshot(snapshot);
    console.log(`Saved ${snapshot.costume.slug}: ${snapshot.pieces.length} pieces, ${snapshot.products.length} products.`);
  }
} catch {
  console.error("Catalog seed failed. Check database configuration and snapshot validity.");
  process.exitCode = 1;
}
