import { z } from "zod";
import { getFewestShops, getProductOption } from "@/lib/catalog";
import type { ProductOption } from "@/lib/types";

// POST { items: [{ pieceId, productId }] } -> merchants that could consolidate the cart,
// with the full product data for each swap so the client can rebuild its cart lines.

const body = z.object({
  items: z.array(z.object({ pieceId: z.string().min(1), productId: z.string().min(1) })).max(20),
});

export interface FewestShopsSuggestion {
  merchant: { id: string; name: string };
  items: { pieceId: string; option: ProductOption }[];
}

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { items } = parsed.data;
  if (items.length < 2) return Response.json({ suggestions: [] });

  try {
    const shared = await getFewestShops(items.map((i) => i.productId));
    const pieceIds = [...new Set(items.map((i) => i.pieceId))];
    const suggestions: FewestShopsSuggestion[] = [];
    for (const { merchant, productIds } of shared) {
      const resolved: FewestShopsSuggestion["items"] = [];
      for (const productId of productIds) {
        // A product id can match more than one piece; take the first cart piece it matches.
        for (const pieceId of pieceIds) {
          const option = await getProductOption(productId, pieceId);
          if (option) { resolved.push({ pieceId, option }); break; }
        }
      }
      suggestions.push({ merchant: { id: merchant.id, name: merchant.name }, items: resolved });
    }
    return Response.json({ suggestions });
  } catch {
    return Response.json({ suggestions: [] });
  }
}
