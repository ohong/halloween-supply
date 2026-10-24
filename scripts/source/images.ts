// Step 6: download chosen product images, cut out backgrounds, compose tiles and the flat-lay.
import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { cacheDir } from "../../lib/sourcing/cache";
import { composeFlatlay, normalizeProductImage } from "../../lib/sourcing/images";
import { mapLimit } from "../../lib/sourcing/pool";
import { photoPlans } from "./photo-plans";
import type { Product } from "../../lib/types";

export const PRODUCTS_DIR = path.join(process.cwd(), "public", "products");
const cutoutPath = (id: string) => path.join(cacheDir(), "images", "cutouts", `${id}.png`);
const publishedCutoutPath = (id: string) => path.join(PRODUCTS_DIR, `${id}-cutout.png`);

async function publishCutout(product: Product): Promise<void> {
  await mkdir(PRODUCTS_DIR, { recursive: true });
  await sharp(cutoutPath(product.id))
    .resize({ width: 1000, height: 1250, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(publishedCutoutPath(product.id));
  product.cutout = `/products/${product.id}-cutout.png`;
}

export function localImagePath(productId: string): string {
  return path.join(PRODUCTS_DIR, `${productId}.jpg`);
}

/** Use the processed tile when it exists on disk, else keep the remote URL. */
export function applyExistingTiles(products: Product[]): void {
  for (const p of products) {
    if (existsSync(localImagePath(p.id))) p.image = `/products/${p.id}.jpg`;
    if (existsSync(publishedCutoutPath(p.id))) p.cutout = `/products/${p.id}-cutout.png`;
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
    const plan = photoPlans[p.id];
    if (plan?.reviewedCutout) {
      await normalizeProductImage(path.resolve(plan.reviewedCutout), out, { skipRembg: true, cutoutPath: cutoutPath(p.id) });
      await publishCutout(p);
      p.image = `/products/${p.id}.jpg`;
      withCutout.add(p.id);
      opts.log(`  reviewed cutout: ${p.id}`);
      return;
    }
    if (!opts.force && existsSync(out) && (existsSync(cutoutPath(p.id)) || existsSync(publishedCutoutPath(p.id)))) {
      if (!existsSync(cutoutPath(p.id))) {
        await mkdir(path.dirname(cutoutPath(p.id)), { recursive: true });
        await copyFile(publishedCutoutPath(p.id), cutoutPath(p.id));
      }
      await publishCutout(p);
      p.image = `/products/${p.id}.jpg`;
      withCutout.add(p.id);
      return;
    }
    const sources = plan ? [plan.sourceUrl] : p.sourceImages.slice(0, 3);
    if (plan && !p.sourceImages.includes(plan.sourceUrl)) p.sourceImages.unshift(plan.sourceUrl);
    let lastErr: unknown = new Error("no source images");
    for (const src of sources) {
      try {
        const file = await downloadImage(src, p.id);
        await normalizeProductImage(file, out, { cutoutPath: cutoutPath(p.id), ...plan });
        await publishCutout(p);
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

export async function buildFlatlay(slug: string, defaultProductIds: string[], withCutout: Set<string>, log: (m: string) => void, scales?: number[]): Promise<boolean> {
  const inputs = defaultProductIds.filter((id) => withCutout.has(id) || existsSync(cutoutPath(id)) || existsSync(publishedCutoutPath(id)))
    .map((id) => existsSync(publishedCutoutPath(id)) ? publishedCutoutPath(id) : cutoutPath(id));
  if (inputs.length < 2 || inputs.length !== defaultProductIds.length) {
    log(`  flat-lay skipped: ${inputs.length}/${defaultProductIds.length} default cutouts available`);
    return false;
  }
  await composeFlatlay(inputs, path.join(PRODUCTS_DIR, `${slug}-flatlay.jpg`), { scales });
  return true;
}
