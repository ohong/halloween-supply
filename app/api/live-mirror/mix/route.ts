import { z } from "zod";
import { readMirrorInventory } from "@/lib/live-mirror/catalog-server";
import { mixMirrorPieces } from "@/lib/live-mirror/mixed-outfit";
import { mixSchema, readVoiceRequest, requestBase, validatedCostume, voiceFailure, voiceResponse, VoiceError } from "@/lib/live-mirror/voice-server";

const action = z.object({ type: z.literal("mix"), source: mixSchema.omit({ replacesPieceId: true }), replacesPieceId: mixSchema.shape.replacesPieceId }).strict();
const schema = requestBase.extend({ actions: z.array(action).min(1).max(6) }).strict();

/** Resolve source IDs again at application time; never accept client product data or prices. */
export async function POST(request: Request) {
  try {
    const { costumeSlug, outfit, actions } = schema.parse(await readVoiceRequest(request, "command"));
    const inventory = await readMirrorInventory();
    const current = await validatedCostume(costumeSlug, outfit, inventory.views);
    const base = inventory.views.find(view => view.costume.slug === costumeSlug)!;
    try { return voiceResponse(mixMirrorPieces(base, current, outfit, actions, inventory.views)); }
    catch (error) { throw new VoiceError(409, error instanceof Error ? error.message : "That combination could not be applied."); }
  } catch (error) { return voiceFailure(error); }
}
