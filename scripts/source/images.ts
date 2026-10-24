// Step 6: download chosen product images, cut out backgrounds, compose tiles and the flat-lay.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { cacheDir } from "../../lib/sourcing/cache";
import { composeFlatlay, normalizeProductImage } from "../../lib/sourcing/images";
import { mapLimit } from "../../lib/sourcing/pool";
import type { Product } from "../../lib/types";

export const PRODUCTS_DIR = path.join(process.cwd(), "public", "products");
const cutoutPath = (id: string) => path.join(cacheDir(), "images", "cutouts", `${id}.png`);

export function localImagePath(productId: string): string {
  return path.join(PRODUCTS_DIR, `${productId}.jpg`);
}

/** Use the processed tile when it exists on disk, else keep the remote URL. */
export function applyExistingTiles(products: Product[]): void {
  for (const p of products) {
    if (existsSync(localImagePath(p.id))) p.image = `/products/${p.id}.jpg`;
  }
}

async function downloadImage(url: string, id: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; halloween-supply-pipeline/1.0)", Accept: "image/*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) throw new Error(`not an image (${type || "no content-type"})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000) throw new Error("image too small");
    const dir = path.join(cacheDir(), "images", "src");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${id}.img`);
    await writeFile(file, buf);
    return file;
  } finally {
    clearTimeout(timer);
  }
}

export interface ImageStepOptions {
  force?: boolean;
  log: (msg: string) => void;
}

/** Process every product's first usable image. Failures keep the remote URL. Returns ids with a cutout. */
export async function processProductImages(products: Product[], opts: ImageStepOptions): Promise<Set<string>> {
  const withCutout = new Set<string>();
  await mapLimit(products, 2, async (p) => {
    const out = localImagePath(p.id);
    if (!opts.force && existsSync(out) && existsSync(cutoutPath(p.id))) {
      p.image = `/products/${p.id}.jpg`;
      withCutout.add(p.id);
      return;
    }
    let lastErr: unknown = new Error("no source images");
    for (const src of p.sourceImages.slice(0, 3)) {
      try {
        const file = await downloadImage(src, p.id);
        await normalizeProductImage(file, out, { cutoutPath: cutoutPath(p.id) });
        p.image = `/products/${p.id}.jpg`;
        withCutout.add(p.id);
        opts.log(`  image ok: ${p.id}`);
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    opts.log(`  image skipped for ${p.id} (keeping remote URL): ${(lastErr as Error).message}`);
  });
  return withCutout;
}

export async function buildFlatlay(slug: string, defaultProductIds: string[], withCutout: Set<string>, log: (m: string) => void): Promise<boolean> {
  const inputs = defaultProductIds.filter((id) => withCutout.has(id) || existsSync(cutoutPath(id))).map(cutoutPath);
  if (inputs.length < 2) {
    log(`  flat-lay skipped: only ${inputs.length} cutouts available`);
    return false;
  }
  if (inputs.length < defaultProductIds.length) log(`  flat-lay built from ${inputs.length}/${defaultProductIds.length} default picks`);
  await composeFlatlay(inputs, path.join(PRODUCTS_DIR, `${slug}-flatlay.jpg`));
  return true;
}
