import { readMirrorInventory } from "@/lib/live-mirror/catalog-server";
import { videoResponse } from "@/lib/live-mirror/video-server";

/** Public catalog metadata only; no camera, credentials, or inference. */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug");
  const inventory = await readMirrorInventory();
  if (!slug) return videoResponse({ source: inventory.source, looks: inventory.looks, counts: inventory.counts });
  const costume = inventory.views.find(view => view.costume.slug === slug);
  if (!costume) return videoResponse({ error: "This costume is unavailable." }, 404);
  return videoResponse(costume);
}
