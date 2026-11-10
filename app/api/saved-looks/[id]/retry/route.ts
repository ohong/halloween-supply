import { z } from "zod";
import { PreviewError } from "@/lib/ai/openai";
import { sourcePiece, toCartItem } from "@/lib/custom-looks/source";
import { validateCustomItem } from "@/lib/custom-looks/validate";
import { claimCustomLook, readCustomLook, readCustomLookRequest, saveCustomLook } from "@/lib/custom-looks/store";
import { savedLookBody, savedLookFailure, savedLookReply } from "@/lib/custom-looks/http";
import { guardProvider, UNAVAILABLE, type Release } from "@/lib/guard";
import { rejectBot } from "@/lib/bot-guard";
export const maxDuration = 60;
const schema = z.object({ requestId: z.uuid(), pieceIndex: z.number().int().min(0).max(7) }).strict();
const guard = guardProvider("saved-look-retry", { maxActive: 3 });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await rejectBot();
  if (blocked) return blocked;
  let release: Release | undefined;
  try {
    const body = await savedLookBody(request, schema, 1000);
    const original = await readCustomLook((await params).id);
    if (!original) throw new PreviewError(404, "This saved look could not be found.");
    const row = original.pieces[body.pieceIndex];
    if (!row || row.item) throw new PreviewError(400, "Choose a missing piece to search again.");
    const query = `Retry ${original.id}:${body.pieceIndex}`;
    const previous = await readCustomLookRequest(body.requestId);
    if (previous) {
      if (previous.query !== query) throw new PreviewError(409, "This retry belongs to another piece.");
      if (previous.state === "running") throw new PreviewError(409, "This piece is still being searched. Retry shortly to reopen the saved result.");
      return savedLookReply(200, { id: previous.id, href: `/create/${previous.id}`, look: previous });
    }
    if (!process.env.FIRECRAWL_API_KEY || !process.env.ANTHROPIC_API_KEY) throw new PreviewError(503, "Piece search is unavailable right now. Your saved products are unchanged.");
    const lease = guard.acquire();
    if (lease === "disabled") throw new PreviewError(503, UNAVAILABLE);
    if (lease === "busy") throw new PreviewError(429, "Piece search is busy. Please try again shortly.");
    release = lease;
    const claimed = await claimCustomLook({ requestId: body.requestId, query, model: original.model });
    if (!claimed.claimed) throw new PreviewError(409, "This piece is already being searched. Retry shortly.");
    let look = { ...original, id: claimed.look.id, query, createdAt: claimed.look.createdAt, state: "running" as const, error: undefined };
    await saveCustomLook(look);
    try {
      const hit = await sourcePiece(row.piece, () => undefined, AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]), { strictRelevance: true });
      const item = hit ? validateCustomItem(toCartItem(body.pieceIndex, row.piece, hit, `custom-${look.id}`)) : null;
      if (item && !look.pieces.some(existing => existing.item?.productId === item.productId)) look = { ...look, pieces: look.pieces.map((existing, index) => index === body.pieceIndex ? { ...existing, item: { ...item, size: null } } : existing) };
      const found = look.pieces.filter(existing => existing.item).length;
      const result = { ...look, state: found === look.pieces.length ? "complete" as const : found > 0 ? "partial" as const : "failed" as const,
        ...(item ? {} : { error: "No verified product was found for this piece. Your other products are saved." }) };
      await saveCustomLook(result);
      return savedLookReply(200, { id: result.id, href: `/create/${result.id}`, look: result });
    } catch {
      const result = { ...look, state: look.pieces.some(existing => existing.item) ? "partial" as const : "failed" as const, error: "This piece could not be searched. Your other products are saved." };
      await saveCustomLook(result);
      return savedLookReply(200, { id: result.id, href: `/create/${result.id}`, look: result });
    }
  } catch (error) { return savedLookFailure(error); }
  finally { release?.(); }
}
