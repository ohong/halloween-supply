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
    return videoResponse({ prompt });
  } catch (error) { return videoFailure(error); }
  finally { if (reserved) active--; }
}
