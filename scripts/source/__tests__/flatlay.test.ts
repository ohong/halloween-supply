import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { composeFlatlay, normalizeProductImage, trimTransparent } from "../../../lib/sourcing/images";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(process.env.SCRATCH_DIR ?? os.tmpdir(), "flatlay-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

// A solid-colour rectangle on a transparent field, like a rembg cutout.
async function cutout(file: string, w: number, h: number, rgb: [number, number, number]) {
  const pad = 40;
  await sharp({ create: { width: w + pad * 2, height: h + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: { create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }, left: pad, top: pad }])
    .png()
    .toFile(file);
}

const px = async (file: string, x: number, y: number) => {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
};

describe("composeFlatlay", () => {
  test("5 cutouts on a #EFEEEF 4:5 canvas, each in its own cell", async () => {
    const colors: [number, number, number][] = [[200, 0, 0], [0, 150, 0], [0, 0, 200], [180, 180, 0], [0, 160, 160]];
    const files: string[] = [];
    for (let i = 0; i < 5; i++) {
      const f = path.join(dir, `c${i}.png`);
      await cutout(f, 300 + i * 20, 400, colors[i]);
      files.push(f);
    }
    const out = path.join(dir, "flatlay.jpg");
    await composeFlatlay(files, out);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([1500, 1875]);
    expect(meta.width! / meta.height!).toBeCloseTo(0.8, 5);
    // Corner is the tile grey (#EFEEEF = 239,238,239), allowing JPEG error.
    const corner = await px(out, 5, 5);
    expect(Math.abs(corner[0] - 239)).toBeLessThan(3);
    // Every colour appears somewhere (each piece rendered), sampled via a coarse scan.
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const found = colors.map(() => false);
    for (let y = 0; y < info.height; y += 20) {
      for (let x = 0; x < info.width; x += 20) {
        const i = (y * info.width + x) * 3;
        colors.forEach((c, k) => {
          if (Math.abs(data[i] - c[0]) < 12 && Math.abs(data[i + 1] - c[1]) < 12 && Math.abs(data[i + 2] - c[2]) < 12) found[k] = true;
        });
      }
    }
    expect(found).toEqual([true, true, true, true, true]);
  });

  test("single image and custom size", async () => {
    const f = path.join(dir, "one.png");
    await cutout(f, 200, 300, [10, 10, 200]);
    const out = path.join(dir, "one.jpg");
    await composeFlatlay([f], out, { width: 400, height: 500 });
    const m = await sharp(out).metadata();
    expect([m.width, m.height]).toEqual([400, 500]);
  });

  test("rejects empty input", async () => {
    await expect(composeFlatlay([], path.join(dir, "x.jpg"))).rejects.toThrow();
  });
});

describe("images", () => {
  test("trimTransparent crops to the opaque box", async () => {
    const f = path.join(dir, "t.png");
    await cutout(f, 120, 80, [255, 0, 0]);
    const trimmed = await trimTransparent(await sharp(f).png().toBuffer());
    const m = await sharp(trimmed).metadata();
    expect([m.width, m.height]).toEqual([120, 80]);
  });

  test("normalizeProductImage (rembg skipped) gives a centred 1000x1250 #EFEEEF tile and a cutout", async () => {
    const src = path.join(dir, "src.png");
    await cutout(src, 600, 300, [20, 20, 20]);
    const out = path.join(dir, "tile.jpg");
    const cut = path.join(dir, "cut.png");
    await normalizeProductImage(src, out, { skipRembg: true, cutoutPath: cut });
    const m = await sharp(out).metadata();
    expect([m.width, m.height]).toEqual([1000, 1250]);
    const corner = await px(out, 3, 3);
    expect(Math.abs(corner[0] - 239)).toBeLessThan(3);
    const center = await px(out, 500, 625);
    expect(center[0]).toBeLessThan(40);
    expect((await sharp(cut).metadata()).hasAlpha).toBe(true);
  });
});
