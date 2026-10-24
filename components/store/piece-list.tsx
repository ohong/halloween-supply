"use client";

import { useState } from "react";
import { formatPrice, useCart } from "@/lib/cart/context";
import { toCartItem } from "@/lib/cart/item";
import type { PieceView, ProductOption } from "@/lib/types";
import { Chevron, Pin } from "@/components/icons";
import { ProductImage } from "./product-image";
import { useSelection } from "./selection";

/** "Add whole costume": every piece's selected option in one click. */
export function AddWholeCostume() {
  const { view, selectedOption } = useSelection();
  const { items, addMany } = useCart();
  const picks = view.pieces.map((piece) => ({ piece, option: selectedOption(piece) }));
  const total = picks.reduce((sum, { option }) => sum + option.product.priceCents, 0);
  const allIn = picks.every(({ piece, option }) => items.some((l) => l.pieceId === piece.piece.id && l.productId === option.product.id));
  return (
    <button type="button" className={`btn ${allIn ? "btn-done" : ""}`} disabled={allIn} onClick={() => addMany(picks.map(({ piece, option }) => toCartItem(piece.piece, option)))}>
      {allIn ? "Whole costume in cart" : `Add whole costume · ${formatPrice(total)}`}
    </button>
  );
}

export function PieceList() {
  const { view } = useSelection();
  return (
    <ol className="pieces" aria-label="Pieces">
      {view.pieces.map((piece, i) => <PieceRow key={piece.piece.id} piece={piece} number={i + 1} />)}
    </ol>
  );
}

function PieceRow({ piece, number }: { piece: PieceView; number: number }) {
  const { selectedOption, select, focusPiece } = useSelection();
  const { items, add } = useCart();
  const [openPanel, setOpenPanel] = useState<"why" | "swap" | null>(null);
  const option = selectedOption(piece);
  const alternatives = piece.options.filter((o) => o.product.id !== option.product.id);
  const line = items.find((l) => l.pieceId === piece.piece.id);
  const inCart = line?.productId === option.product.id;
  const idBase = `piece-${piece.piece.id}`;
  const toggle = (panel: "why" | "swap") => setOpenPanel((cur) => (cur === panel ? null : panel));

  return (
    <li className="piece">
      <div className="piece-main">
        <button type="button" className="thumb" onClick={() => focusPiece(piece.piece.id)} aria-label={`Show ${piece.piece.name} in the photos`}>
          <ProductImage src={option.product.image} alt="" sizes="72px" />
        </button>
        <div>
          <p className="piece-kicker mono"><span>{String(number).padStart(2, "0")} · {piece.piece.name}</span><span className="piece-price">{formatPrice(option.product.priceCents)}</span></p>
          <h3 className="piece-title"><a href={option.product.url} target="_blank" rel="noopener noreferrer">{option.product.title}</a></h3>
          <p className="piece-merchant">{option.merchant.name}{option.neighborhood ? ` · ${option.neighborhood.name}` : ""}</p>
          <PieceTags option={option} />
        </div>
      </div>
      <div className="piece-actions">
        <button type="button" className={`btn ${inCart ? "btn-done" : ""}`} disabled={inCart} onClick={() => add(toCartItem(piece.piece, option))}>
          {inCart ? "In cart" : line ? "Update cart" : "Add to cart"}
        </button>
        <div className="piece-links">
          <button type="button" className="disclosure-toggle" aria-expanded={openPanel === "why"} aria-controls={`${idBase}-why`} onClick={() => toggle("why")}>Why this pick <Chevron dir={openPanel === "why" ? "up" : "down"} /></button>
          {alternatives.length > 0 && <button type="button" className="disclosure-toggle" aria-expanded={openPanel === "swap"} aria-controls={`${idBase}-swap`} onClick={() => toggle("swap")}>Swap <Chevron dir={openPanel === "swap" ? "up" : "down"} /></button>}
        </div>
      </div>
      {openPanel === "why" && (
        <div className="panel-why" id={`${idBase}-why`}>
          <p>{option.pick.reason}</p>
          <ol className="path mono" aria-label="Graph path">
            {option.pick.path.map((step, i) => <li key={`${step.kind}-${i}`} data-kind={step.kind}>{step.label}</li>)}
          </ol>
        </div>
      )}
      {openPanel === "swap" && (
        <div className="swap-list" id={`${idBase}-swap`} role="group" aria-label={`Alternatives for ${piece.piece.name}`}>
          {alternatives.map((alt) => (
            <button type="button" key={alt.product.id} className="swap-option" onClick={() => { select(piece.piece.id, alt.product.id); setOpenPanel(null); }}>
              <span className="thumb"><ProductImage src={alt.product.image} alt="" sizes="56px" /></span>
              <span>
                <span className="swap-option-title">{alt.product.title}</span><br />
                <span className="swap-option-meta">{alt.merchant.name}{alt.pick.isLocal ? " · Local" : ""}</span>
              </span>
              <span className="swap-option-price">{formatPrice(alt.product.priceCents)}</span>
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

function PieceTags({ option }: { option: ProductOption }) {
  const tags = option.tags.filter((t) => t.slug !== "local");
  if (!option.pick.isLocal && tags.length === 0) return null;
  return (
    <ul className="piece-tags" aria-label="Tags">
      {option.pick.isLocal && <li className="pill pill-local"><Pin />Support local</li>}
      {tags.map((t) => <li className="pill" key={t.slug}>{t.label}</li>)}
    </ul>
  );
}
