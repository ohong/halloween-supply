import { z } from "zod";
import { PreviewError } from "@/lib/ai/openai";
import { isDatabaseConfigured } from "@/lib/db/client";
import { customPieceSchema, validateCustomItem } from "@/lib/custom-looks/validate";
import { isSourcedItemSigningAvailable, verifySourcedItem } from "@/lib/custom-looks/item-proof";
import { saveScreenshotLook } from "@/lib/custom-looks/store";
import { savedLookBody, savedLookFailure, savedLookReply } from "@/lib/custom-looks/http";
import { rejectBot } from "@/lib/bot-guard";

const schema = z.object({
  requestId: z.uuid(), name: z.string().trim().min(1).max(160), summary: z.string().max(240).default(""),
  model: z.enum(["male", "female"]),
  pieces: z.array(z.object({ piece: customPieceSchema, item: z.unknown().nullable(), proof: z.string().max(64).optional() }).strict()).min(1).max(8),
}).strict();
export async function POST(request: Request) {
  const blocked = await rejectBot();
  if (blocked) return blocked;
  try {
    const body = await savedLookBody(request, schema);
    if (!isSourcedItemSigningAvailable()) throw new PreviewError(503, "Saving this look is unavailable right now. Your found pieces remain on this board.");
    const pieces = body.pieces.map(({ piece, item, proof }) => {
      if (item === null) return { piece, item: null };
      const validated = validateCustomItem({ ...(item as object), size: null });
      if (!proof || !verifySourcedItem(validated, proof)) throw new PreviewError(400, "A product could not be verified. Source that piece again before saving.");
      return { piece: { ...piece, name: validated.pieceName, sizeKind: validated.sizeKind }, item: validated };
    });
    const found = pieces.filter(row => row.item).length;
    const items = pieces.flatMap(row => row.item ? [row.item] : []);
    if (new Set(items.map(item => item.pieceId)).size !== items.length || new Set(items.map(item => item.productId)).size !== items.length) throw new PreviewError(400, "Use each found product only once in this look.");
    if (!found) throw new PreviewError(400, "Find at least one product before saving this look.");
    if (!isDatabaseConfigured()) throw new PreviewError(503, "Saved looks are unavailable right now. Your found pieces remain on this board.");
    const look = await saveScreenshotLook(body.requestId, { query: `Screenshot: ${body.name}`.slice(0, 160), name: body.name, summary: body.summary, model: body.model,
      state: found === pieces.length ? "complete" : "partial", pieces });
    return savedLookReply(200, { id: look.id, href: `/create/${look.id}`, look });
  } catch (error) { return savedLookFailure(error); }
}
