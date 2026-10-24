import type { Merchant, ProductOption } from "@/lib/types";

export interface Consolidation {
  merchant: Merchant;
  pieceNames: string[];
  shopCount: number;
}

/** Suggest a merchant only when swapping its available matches actually removes a shop. */
export function suggestConsolidation(
  pieces: { id: string; name: string; options: ProductOption[] }[],
  picked: Map<string, ProductOption | undefined>,
): Consolidation[] {
  const pickedMerchants = new Set([...picked.values()].flatMap((option) => (option ? [option.merchant.id] : [])));
  const byMerchant = new Map<string, Consolidation>();
  for (const piece of pieces) {
    for (const option of piece.options) {
      if (option.product.availability === "out_of_stock") continue;
      const entry = byMerchant.get(option.merchant.id) ?? { merchant: option.merchant, pieceNames: [], shopCount: pickedMerchants.size };
      if (picked.get(piece.id)?.merchant.id !== option.merchant.id && !entry.pieceNames.includes(piece.name)) entry.pieceNames.push(piece.name);
      byMerchant.set(option.merchant.id, entry);
    }
  }
  return [...byMerchant.values()]
    .map((entry) => {
      const shops = new Set(pieces.flatMap((piece) => {
        const current = picked.get(piece.id);
        if (!current) return [];
        const canSwap = piece.options.some(({ product, merchant }) => merchant.id === entry.merchant.id && product.availability !== "out_of_stock");
        return [canSwap ? entry.merchant.id : current.merchant.id];
      }));
      return { ...entry, shopCount: shops.size };
    })
    .filter((entry) => entry.pieceNames.length > 0 && entry.shopCount < pickedMerchants.size)
    .sort((a, b) => a.shopCount - b.shopCount || b.pieceNames.length - a.pieceNames.length);
}
