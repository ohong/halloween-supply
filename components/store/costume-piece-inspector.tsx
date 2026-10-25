"use client";

import { formatExactPrice, useCart } from "@/lib/cart/context";
import { toCartItem } from "@/lib/cart/item";
import type { PieceView } from "@/lib/types";
import { PieceInspectionPanel } from "./piece-inspection-panel";
import "./costume-piece-inspector.css";

export function CostumePieceInspector({ costumeSlug, view, index, size, onSizeChange, onAdd, onChoose, onClose }: { costumeSlug: string; view: PieceView; index: number; size: string | null; onSizeChange: (size: string) => void; onAdd: () => void; onChoose: (index: number) => void; onClose: () => void }) {
  const cart = useCart();
  const option = view.options[index] ?? view.options[0];
  if (!option) return null;
  const current = cart.costumeSlug === costumeSlug ? cart.items.find((line) => line.pieceId === view.piece.id && line.productId === option.product.id) : undefined;
  const item = toCartItem(view.piece, option, size);
  const inCart = cart.ready && !!current;

  return <div className="costume-piece-inspector">
    <PieceInspectionPanel
      id="costume-piece-inspection"
      item={item}
      size={item.size}
      inCart={inCart}
      addDisabled={!cart.ready || option.product.availability === "out_of_stock"}
      onSizeChange={onSizeChange}
      onAdd={() => {
        if (!cart.ready || option.product.availability === "out_of_stock") return;
        if (!inCart) onAdd();
        cart.setOpen(true);
      }}
      onClose={onClose}
    >
      <fieldset className="costume-piece-alternatives">
        <legend>Choose your version</legend>
        <div>
          {[...view.options].sort((a, b) => a.product.priceCents - b.product.priceCents).map((candidate) => <button key={candidate.product.id} type="button" aria-pressed={candidate.product.id === option.product.id} disabled={candidate.product.availability === "out_of_stock"} onClick={() => onChoose(view.options.indexOf(candidate))}>
            <span>{candidate.pick.priceTier} · {formatExactPrice(candidate.product.priceCents)}</span>
            <span>{candidate.merchant.name}</span>
            {candidate.product.availability === "out_of_stock" && <span>Sold out</span>}
          </button>)}
        </div>
      </fieldset>
      <p className="costume-piece-match-note">The image is style inspiration. These are the real products selected for your look.</p>
      {option.product.availability === "out_of_stock" && <p role="status">This product is sold out. Choose another version.</p>}
    </PieceInspectionPanel>
  </div>;
}
