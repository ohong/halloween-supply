import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CostumeSnapshot } from "../types";

/** Script helper: load data/costumes/<slug>.json, or any path ending in .json. */
export async function loadSnapshot(arg = "cosmic-cowboy"): Promise<CostumeSnapshot> {
  const file = arg.endsWith(".json") ? path.resolve(arg) : path.join(process.cwd(), "data", "costumes", `${arg}.json`);
  return JSON.parse(await readFile(file, "utf8")) as CostumeSnapshot;
}
