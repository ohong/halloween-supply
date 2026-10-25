"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { formatExactPrice } from "@/lib/cart/context";
import type { CartItem } from "@/lib/types";
import "./piece-inspection-panel.css";

export interface PieceInspectionPanelProps {
  id: string;
  item: CartItem;
  size: string | null;
  inCart: boolean;
  onSizeChange: (size: string) => void;
  onAdd: () => void;
  onClose: () => void;
  /** Curated looks can supply real alternatives without inventing screenshot matches. */
  children?: ReactNode;
}

/** A nonmodal inspection surface. The caller owns selection and trigger focus. */
export function PieceInspectionPanel({ id, item, size, inCart, onSizeChange, onAdd, onClose, children }: PieceInspectionPanelProps) {
  const panel = useRef<HTMLElement>(null);

  useEffect(() => { panel.current?.focus(); }, [id, item.pieceId]);

  return <section
    id={id}
    ref={panel}
    className="piece-inspection"
    aria-labelledby={`${id}-title`}
    tabIndex={-1}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    }}
  >
    <div className="piece-inspection-head">
      <h2 id={`${id}-title`}>{item.pieceName}</h2>
      <button type="button" className="piece-inspection-close" onClick={onClose} aria-label={`Close ${item.pieceName} details`}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="m4 4 10 10M14 4 4 14" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
    </div>
    <div className="piece-inspection-image">
      {/* eslint-disable-next-line @next/next/no-img-element -- actual merchant photograph, from arbitrary shop CDNs */}
      <img src={item.image} alt={item.title} referrerPolicy="no-referrer" />
    </div>
    <div className="piece-inspection-product">
      <h3>{item.title}</h3>
      <p>{item.merchantName}</p>
      <strong>{formatExactPrice(item.priceCents)}</strong>
    </div>
    {children}
    {item.sizeKind === "one_size" ? <p className="piece-inspection-size-note">One size</p>
      : item.availableSizes.length > 0 ? <label className="piece-inspection-size">
        Size
        <select value={size ?? ""} onChange={(event) => onSizeChange(event.target.value)}>
          <option value="">Pick a size</option>
          {item.availableSizes.map((offered) => <option key={offered} value={offered}>{offered}</option>)}
        </select>
      </label>
      : <p className="piece-inspection-size-note">Sizes are not listed. Check the merchant page.</p>}
    <div className="piece-inspection-actions">
      <button type="button" className="btn btn-block" onClick={onAdd}>{inCart ? "View cart" : "Add piece to cart"}</button>
      <a href={item.productUrl} target="_blank" rel="noopener noreferrer">
        View at {item.merchantName}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 11 11 3M4 3h7v7" stroke="currentColor" strokeWidth="1.25" /></svg>
        <span className="piece-inspection-sr"> (opens in a new tab)</span>
      </a>
    </div>
    <p className="piece-inspection-note">Prices and stock are checked again at checkout.</p>
  </section>;
}
