import { describe, expect, it } from "bun:test";
import { applyActions, createOutfit, outfitTotal } from "./state";
import type { CostumeView, ProductOption } from "@/lib/types";

const option = (id: string, priceCents: number, stock = "in_stock") => ({ product: { id, priceCents, availability: stock, sizes: [] }, merchant: { id: "shop", kind: "boutique" }, pick: { rank: 0 } }) as unknown as ProductOption;
const costume = { costume: { slug: "test" }, pieces: [
  { piece: { id: "hat", name: "Hat", required: true, sizeKind: "hat" }, options: [option("hat-a", 5000), option("hat-b", 1000), option("hat-sold", 100, "out_of_stock")] },
  { piece: { id: "scarf", name: "Scarf", required: false, sizeKind: "one_size" }, options: [option("scarf-a", 2000), option("scarf-b", 500)] },
] } as CostumeView;

describe("mirror outfit invariants", () => {
  it("preserves locked products when optimizing budget and reports impossible budgets", () => {
    const start = createOutfit(costume);
    const { outfit, message } = applyActions(costume, start, [{ type: "lock", pieceId: "hat", locked: true }, { type: "budget", amount: "20" }, { type: "cheapest" }]);
    expect(outfit.selection.hat).toBe("hat-a");
    expect(outfit.selection.scarf).toBe("scarf-b");
    expect(message!).toMatch(/over budget/);
    expect(start.selection.scarf).toBe("scarf-a");
  });
  it("never selects sold-out, foreign, or unknown products or drops required pieces", () => {
    const start = createOutfit(costume);
    for (const productId of ["hat-sold", "scarf-b", "invented"]) expect(applyActions(costume, start, [{ type: "select", pieceId: "hat", productId }]).outfit.selection.hat).toBe("hat-a");
    expect(applyActions(costume, start, [{ type: "use", pieceId: "hat", use: "skip" }]).outfit.uses.hat).toBe("buy");
  });
  it("excludes owned/skipped pieces from totals and changes only the requested slot", () => {
    const start = createOutfit(costume);
    const { outfit } = applyActions(costume, start, [{ type: "use", pieceId: "hat", use: "owned" }, { type: "select", pieceId: "scarf", productId: "scarf-b" }]);
    expect(outfitTotal(costume, outfit)).toBe(500);
    expect(outfit.selection.hat).toBe(start.selection.hat);
  });
  it("requires explicit unlocking and rejects invalid budgets", () => {
    const start = createOutfit(costume, { locked: ["hat"], budget: "50" });
    expect(applyActions(costume, start, [{ type: "select", pieceId: "hat", productId: "hat-b" }]).outfit.selection.hat).toBe("hat-a");
    expect(applyActions(costume, start, [{ type: "lock", pieceId: "hat", locked: false }, { type: "select", pieceId: "hat", productId: "hat-b" }]).outfit.selection.hat).toBe("hat-b");
    expect(applyActions(costume, start, [{ type: "budget", amount: "Infinity" }]).outfit.budget).toBe("50");
  });
});
