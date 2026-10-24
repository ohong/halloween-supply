// Image normalisation: background removal (rembg via uvx) onto the shared #EFEEEF tile,
// and the knolled flat-lay. Usable standalone (no pipeline state).
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp, { type OverlayOptions } from "sharp";

const run = promisify(execFile);

export const TILE_BACKGROUND = "#EFEEEF";
export const TILE_WIDTH = 1000;
export const TILE_HEIGHT = 1250; // 4:5

export interface NormalizeOptions {
  /** Where to also write the trimmed transparent cutout (PNG). Used for the flat-lay. */
  cutoutPath?: string;
  /** Fraction of the canvas the product may fill. Default 0.82. */
  fill?: number;
  /** Skip rembg and use the image as-is (already transparent or pre-cut). */
  skipRembg?: boolean;
  /** Reviewed crop, expressed as fractions of the original image dimensions. */
  crop?: { left: number; top: number; width: number; height: number };
  /** Reviewed exterior silhouette. Coordinates are fractions of the source image. */
  polygon?: Array<[number, number]>;
  /** Remove exposed upper legs in the reviewed silver boot photograph only. */
  removeUpperSkin?: boolean;
}

/** Run rembg on a PNG. Throws with the tool's stderr when it fails. */
export async function removeBackground(inPng: string, outPng: string): Promise<void> {
  try {
    await run("uvx", ["--from", "rembg[cli,cpu]==2.0.86", "rembg", "i", "-m", "u2net", inPng, outPng], {
      timeout: 2 * 60_000,
      env: { ...process.env, OMP_NUM_THREADS: "1" },
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    throw new Error(`rembg failed: ${(err.stderr || err.message || "unknown error").toString().slice(-400)}`);
  }
}

/** Crop a transparent PNG to the bounding box of pixels with alpha above the threshold. */
export async function trimTransparent(png: Buffer, alphaThreshold = 16): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return png; // fully transparent: leave it alone
  return sharp(png)
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toBuffer();
}

/**
 * Remove the background from inPath, trim, and centre the product on a #EFEEEF 1000x1250 canvas
 * written to outPath as JPEG. Throws if rembg fails (callers keep the remote URL).
 */
export async function normalizeProductImage(inPath: string, outPath: string, opts: NormalizeOptions = {}): Promise<void> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "hs-img-"));
  try {
    const inPng = path.join(tmp, "in.png");
    const cutPng = path.join(tmp, "out.png");
    let source = sharp(inPath).rotate();
    if (opts.crop) {
      const rotated = await source.toBuffer();
      const { width = 1, height = 1 } = await sharp(rotated).metadata();
      source = sharp(rotated).extract({
        left: Math.round(width * opts.crop.left), top: Math.round(height * opts.crop.top),
        width: Math.round(width * opts.crop.width), height: Math.round(height * opts.crop.height),
      });
    }
    await source.flatten({ background: "#ffffff" }).png().toFile(inPng);
    if (opts.skipRembg) await sharp(inPath).rotate().ensureAlpha().png().toFile(cutPng);
    else await removeBackground(inPng, cutPng);

    let cutout: Buffer = await sharp(cutPng).ensureAlpha().png().toBuffer();
    if (opts.polygon) {
      const { width = 1, height = 1 } = await sharp(cutout).metadata();
      const points = opts.polygon.map(([x, y]) => `${x * width},${y * height}`).join(" ");
      const silhouette = Buffer.from(`<svg width="${width}" height="${height}"><polygon points="${points}" fill="white"/></svg>`);
      cutout = await sharp(cutout).composite([{ input: silhouette, blend: "dest-in" }]).png().toBuffer();
    }
    if (opts.removeUpperSkin) cutout = await removeReviewedUpperSkin(cutout);
    const trimmed = await trimTransparent(cutout);
    if (opts.cutoutPath) {
      await mkdir(path.dirname(opts.cutoutPath), { recursive: true });
      await sharp(trimmed).toFile(opts.cutoutPath);
    }
    const fill = opts.fill ?? 0.82;
    const fitted = await sharp(trimmed)
      .resize({ width: Math.round(TILE_WIDTH * fill), height: Math.round(TILE_HEIGHT * fill), fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer();
    await mkdir(path.dirname(outPath), { recursive: true });
    await sharp({ create: { width: TILE_WIDTH, height: TILE_HEIGHT, channels: 3, background: TILE_BACKGROUND } })
      .composite([{ input: fitted, gravity: "centre" }])
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(outPath);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Only upper skin is removed; the silver leather and brown heels keep their pixels. */
async function removeReviewedUpperSkin(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height * 0.4; y++) for (let x = 0; x < info.width; x++) {
    const offset = (y * info.width + x) * 4;
    const [r, g, b] = [data[offset], data[offset + 1], data[offset + 2]];
    if (r > 60 && r > g * 1.12 && g > b * 1.1) data[offset + 3] = 0;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

export interface FlatlayOptions {
  width?: number;
  height?: number;
  /** Outer margin as a fraction of width. Default 0.07. */
  margin?: number;
  /** Gap between cells as a fraction of width. Default 0.04. */
  gap?: number;
}

/**
 * Knolled flat-lay: a tidy grid of the given cutouts on #EFEEEF (default 1500x1875, 4:5).
 * Transparent PNG cutouts work best; opaque images are composited as they are. Incomplete
 * last rows are centred. Items are trimmed and fitted to equal cells.
 */
export async function composeFlatlay(imagePaths: string[], outPath: string, opts: FlatlayOptions = {}): Promise<void> {
  if (imagePaths.length === 0) throw new Error("composeFlatlay needs at least one image");
  const W = opts.width ?? 1500;
  const H = opts.height ?? 1875;
  const margin = Math.round(W * (opts.margin ?? 0.07));
  const gap = Math.round(W * (opts.gap ?? 0.04));
  const n = imagePaths.length;

  // Choose the column count whose cell shape is closest to the item aspect (~4:5 portrait).
  let best = { cols: 1, rows: n, score: Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (W - 2 * margin - (cols - 1) * gap) / cols;
    const ch = (H - 2 * margin - (rows - 1) * gap) / rows;
    const score = Math.abs(Math.log(cw / ch / 0.8)) + (rows * cols - n) * 0.15;
    if (score < best.score) best = { cols, rows, score };
  }
  const { cols, rows } = best;
  const cw = Math.floor((W - 2 * margin - (cols - 1) * gap) / cols);
  const ch = Math.floor((H - 2 * margin - (rows - 1) * gap) / rows);

  const layers: OverlayOptions[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const col = i - row * cols;
    const rowWidth = inRow * cw + (inRow - 1) * gap;
    const x0 = Math.round((W - rowWidth) / 2) + col * (cw + gap);
    const y0 = margin + row * (ch + gap);
    const src = await sharp(imagePaths[i]).ensureAlpha().png().toBuffer();
    const trimmed = await trimTransparent(src);
    const fitted = await sharp(trimmed).resize({ width: cw, height: ch, fit: "inside" }).png().toBuffer();
    const meta = await sharp(fitted).metadata();
    layers.push({
      input: fitted,
      left: x0 + Math.round((cw - (meta.width ?? cw)) / 2),
      top: y0 + Math.round((ch - (meta.height ?? ch)) / 2),
    });
  }
  await mkdir(path.dirname(outPath), { recursive: true });
  await sharp({ create: { width: W, height: H, channels: 3, background: TILE_BACKGROUND } })
    .composite(layers)
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(outPath);
}
