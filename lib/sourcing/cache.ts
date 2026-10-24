// Disk cache for raw SERP / Unlocker / Claude responses, keyed by a hash of the request.
// Reruns of the pipeline spend no credits. data/cache/ is gitignored.
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export function cacheDir(): string {
  return path.join(process.cwd(), "data", "cache");
}

export function hashKey(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

export async function readCache<T>(namespace: string, key: unknown): Promise<T | undefined> {
  try {
    const file = path.join(process.cwd(), "data", "cache", namespace, `${hashKey(key)}.json`);
    // Product facts expire quickly; repeated runs must not re-date old stock.
    const maxAge = namespace === "unlocker" || namespace === "shopify" ? 15 * 60_000 : namespace === "serp" ? 24 * 60 * 60_000 : Infinity;
    if (Date.now() - (await stat(file)).mtimeMs > maxAge) return undefined;
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function writeCache(namespace: string, key: unknown, value: unknown): Promise<void> {
  try {
    const dir = path.join(process.cwd(), "data", "cache", namespace);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${hashKey(key)}.json`), JSON.stringify(value));
  } catch {
    // A cache write failure must never fail the pipeline.
  }
}

/** Return the cached value for (namespace, key) or compute, cache and return it. */
export async function cached<T>(namespace: string, key: unknown, compute: () => Promise<T>): Promise<T> {
  const hit = await readCache<T>(namespace, key);
  if (hit !== undefined) return hit;
  const value = await compute();
  await writeCache(namespace, key, value);
  return value;
}
