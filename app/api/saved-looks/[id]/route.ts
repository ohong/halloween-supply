import { readCustomLook } from "@/lib/custom-looks/store";
import { savedLookFailure, savedLookReply } from "@/lib/custom-looks/http";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const look = await readCustomLook((await params).id);
    return look ? savedLookReply(200, { look }) : savedLookReply(404, { error: "This saved look could not be found." });
  } catch (error) { return savedLookFailure(error); }
}
