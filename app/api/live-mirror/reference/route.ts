import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { readMirrorInventory } from "@/lib/live-mirror/catalog-server";
import { composeMirrorCostume } from "@/lib/live-mirror/mixed-outfit";
import { readVideoJson, VideoError, videoFailure, videoResponse } from "@/lib/live-mirror/video-server";
import { resolveVideoOutfit, videoOutfitPrompt, videoOutfitSchema } from "@/lib/live-mirror/video-outfit";

export const maxDuration = 30;
let active = 0;

export async function POST(request: Request) {
  let reserved = false;
  try {
    const input = videoOutfitSchema.parse(await readVideoJson(request));
    if (active >= 3) throw new VideoError(429, "The fitting room is busy. Try again shortly.");
    active++; reserved = true;
    const inventory = await readMirrorInventory();
    const base = inventory.views.find(view => view.costume.slug === input.costumeSlug);
    if (!base) throw new VideoError(400, "Choose a costume from the gallery.");
    let outfit: ReturnType<typeof resolveVideoOutfit>;
    let prompt: string;
    try { const costume = composeMirrorCostume(base, input.mixes ?? [], inventory.views); outfit = resolveVideoOutfit(costume, input); prompt = videoOutfitPrompt(outfit); }
    catch (error) { throw new VideoError(400, error instanceof Error ? error.message : "Choose a valid outfit."); }
    const root = path.resolve(process.cwd(), "public");
    const cellWidth = 340;
    const cellHeight = 440;
    const columns = Math.min(3, outfit.selected.length);
    const layers = await Promise.all(outfit.selected.map(async ({ product }, index) => {
      const src = product.cutout ?? product.image;
      const file = path.resolve(root, `.${src}`);
      // Only our reviewed, local product assets. No user-directed network fetches.
      if (!src.startsWith("/products/") || !file.startsWith(path.join(root, "products") + path.sep)) throw new VideoError(422, "One piece needs a product photo before it can be tried on live.");
      const image = await sharp(await readFile(file), { limitInputPixels: 25_000_000 }).rotate()
        .resize(cellWidth, cellHeight, { fit: "contain", background: "#ffffff" }).flatten({ background: "#ffffff" }).png().toBuffer();
      return { input: image, left: (index % columns) * cellWidth, top: Math.floor(index / columns) * cellHeight };
    }));
    const image = await sharp({ create: { width: Math.max(512, columns * cellWidth), height: Math.max(512, Math.ceil(layers.length / columns) * cellHeight), channels: 3, background: "#ffffff" } })
      .composite(layers).jpeg({ quality: 88 }).toBuffer();
    return videoResponse({ image: `data:image/jpeg;base64,${image.toString("base64")}`, prompt });
  } catch (error) { return videoFailure(error); }
  finally { if (reserved) active--; }
}
