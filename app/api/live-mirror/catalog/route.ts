import { composeMirrorCostume } from "@/lib/live-mirror/mixed-outfit";
import { mixSchema } from "@/lib/live-mirror/mix-schema";
import { z } from "zod";
import { readMirrorInventory } from "@/lib/live-mirror/catalog-server";
import { videoResponse } from "@/lib/live-mirror/video-server";

/** Public catalog metadata only; no camera, credentials, or inference. */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug");
  const inventory = await readMirrorInventory();
  if (!slug) return videoResponse({ source: inventory.source, looks: inventory.looks, counts: inventory.counts });
  const costume = inventory.views.find(view => view.costume.slug === slug);
  if (!costume) return videoResponse({ error: "This costume is unavailable." }, 404);
  const mix = new URL(request.url).searchParams.get("mix");
  try {
    const mixes = mix ? z.array(mixSchema).max(12).parse(JSON.parse(mix)) : [];
    return videoResponse(composeMirrorCostume(costume, mixes, inventory.views));
  } catch { return videoResponse({ error: "The mixed outfit is invalid. Search for those pieces again." }, 400); }
}
