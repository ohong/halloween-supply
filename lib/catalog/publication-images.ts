import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { CostumeSnapshot } from "../types";
import { mapLimit } from "../sourcing/pool";

/** Publication is stricter than reading an older catalog or saving a sourcing draft. */
export type PublicationImage = { file: string; sha256: string };
export class CatalogImageError extends Error {}

export async function validatePublicationImages(snapshot: CostumeSnapshot): Promise<PublicationImage[]> {
  if (snapshot.costume.status !== "live") return [];
  const assets: { file: string; transparent: boolean; merchant?: boolean }[] = [];
  const errors: string[] = [];
  for (const product of snapshot.products) {
    if (product.merchantImage) {
      const merchantImage = `/products/price-tiers/${product.id}.webp`;
      if (product.merchantImage !== merchantImage || product.image !== merchantImage) {
        errors.push(`${product.id} needs its reviewed local merchant photograph`);
      } else assets.push({ file: merchantImage, transparent: false, merchant: true });
      continue;
    }
    const tile = `/products/${product.id}.jpg`;
    const cutout = `/products/${product.id}-cutout.png`;
    if (!/^[a-z0-9-]+$/.test(product.id) || product.image !== tile || product.cutout !== cutout) {
      errors.push(`${product.id} needs its normalized local tile and cutout`);
      continue;
    }
    assets.push({ file: tile, transparent: false }, { file: cutout, transparent: true });
  }
  const flatlay = `/products/${snapshot.costume.slug}-flatlay.jpg`;
  if (!/^[a-z0-9-]+$/.test(snapshot.costume.slug) || snapshot.costume.image !== flatlay) {
    errors.push("the costume needs its complete local flat-lay");
  } else assets.push({ file: flatlay, transparent: false });

  const checks = await mapLimit(assets, 4, async ({ file, transparent, merchant }) => {
    const bytes = await readFile(path.join(process.cwd(), "public", file));
    const image = sharp(bytes, { failOn: "warning" });
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (Math.max(width, height) < (transparent ? 300 : merchant ? 400 : 500) || Math.min(width, height) < 50 ||
      metadata.format !== (transparent ? "png" : merchant ? "webp" : "jpeg")) throw new Error("invalid image dimensions or format");
    // Decode every image, rather than accepting a readable header with corrupt pixel data.
    const stats = await image.stats();
    if (transparent) {
      const alpha = stats.channels.at(-1);
      if (!metadata.hasAlpha || !alpha || alpha.min !== 0 || alpha.max === 0) throw new Error("cutout needs visible product pixels and transparent background");
    } else if (stats.channels.slice(0, 3).every((channel) => channel.min === channel.max)) throw new Error("image is blank");
    return { file, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  checks.forEach((check, index) => {
    if (!check.ok) errors.push(`${assets[index].file} is missing, corrupt or incomplete`);
  });
  if (errors.length) throw new CatalogImageError(`Cannot publish ${snapshot.costume.slug}: ${errors.join("; ")}`);
  return checks.flatMap((check) => check.ok ? [check.value] : []);
}

/** Deploy assets before exposing their paths through the shared production database. */
export async function validateDeployedImages(images: PublicationImage[]): Promise<void> {
  const origin = new URL(process.env.CATALOG_PUBLIC_ORIGIN ?? "https://halloween.supply");
  if (origin.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origin.hostname)) throw new CatalogImageError("Catalog asset origin must use HTTPS.");
  const checks = await mapLimit(images, 4, async ({ file, sha256 }) => {
    const response = await fetch(new URL(file, origin), { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) throw new Error("asset is not deployed");
    const digest = createHash("sha256").update(new Uint8Array(await response.arrayBuffer())).digest("hex");
    if (digest !== sha256) throw new Error("deployed asset differs from the reviewed file");
  });
  const missing = checks.flatMap((check, index) => check.ok ? [] : [images[index].file]);
  if (missing.length) throw new CatalogImageError(`Cannot publish: deploy the complete reviewed images to ${origin.origin} first: ${missing.join(", ")}`);
}
