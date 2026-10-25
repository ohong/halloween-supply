import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CostumeSnapshot } from "../types";
import { validateSnapshot } from "./validate";

/** Script helper: load data/costumes/<slug>.json, or any path ending in .json. */
export async function loadSnapshot(arg = "cosmic-cowboy"): Promise<CostumeSnapshot> {
  const file = arg.endsWith(".json") ? path.resolve(arg) : path.join(process.cwd(), "data", "costumes", `${arg}.json`);
  return validateSnapshot(JSON.parse(await readFile(file, "utf8")));
}
