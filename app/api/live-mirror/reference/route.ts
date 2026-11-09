import { readMirrorInventory } from "@/lib/live-mirror/catalog-server";
import { composeMirrorCostume } from "@/lib/live-mirror/mixed-outfit";
import { readVideoJson, VideoError, videoFailure, videoResponse } from "@/lib/live-mirror/video-server";
import { resolveVideoOutfit, videoOutfitPrompt, videoOutfitSchema } from "@/lib/live-mirror/video-outfit";
import { guardProvider, UNAVAILABLE, type Release } from "@/lib/guard";

export const maxDuration = 30;
const guard = guardProvider("live-mirror-reference", { maxActive: 3 });

export async function POST(request: Request) {
  let release: Release | undefined;
  try {
    const input = videoOutfitSchema.parse(await readVideoJson(request));
    const lease = guard.acquire();
    if (lease === "disabled") throw new VideoError(503, UNAVAILABLE);
    if (lease === "busy") throw new VideoError(429, "The fitting room is busy. Try again shortly.");
    release = lease;
    const inventory = await readMirrorInventory();
    const base = inventory.views.find(view => view.costume.slug === input.costumeSlug);
    if (!base) throw new VideoError(400, "Choose a costume from the gallery.");
    let outfit: ReturnType<typeof resolveVideoOutfit>;
    let prompt: string;
    try { const costume = composeMirrorCostume(base, input.mixes ?? [], inventory.views); outfit = resolveVideoOutfit(costume, input); prompt = videoOutfitPrompt(outfit); }
    catch (error) { throw new VideoError(400, error instanceof Error ? error.message : "Choose a valid outfit."); }
    return videoResponse({ prompt });
  } catch (error) { return videoFailure(error); }
  finally { release?.(); }
}
