import { getCostume } from "@/lib/catalog";
import { costumes } from "@/lib/costumes";
import { videoResponse } from "@/lib/live-mirror/video-server";

/** Public catalog metadata only; no camera, credentials, or inference. */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug");
  if (!costumes.some(costume => costume.slug === slug)) return videoResponse({ error: "Choose a costume from the gallery." }, 400);
  const costume = await getCostume(slug!);
  if (!costume) return videoResponse({ error: "This costume is unavailable." }, 404);
  return videoResponse(costume);
}
