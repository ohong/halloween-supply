import { createPair, failure, reply, sameOrigin } from "@/lib/phone-camera/server";
import { reserveVideoRequest } from "@/lib/live-mirror/video-server";
export async function POST(request: Request) {
  try { sameOrigin(request); reserveVideoRequest(request, "pair"); return reply(await createPair()); }
  catch (error) { return failure(error); }
}
