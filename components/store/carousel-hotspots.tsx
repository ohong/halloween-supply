"use client";

import { useId, useRef, useState } from "react";
import { ShoppingBag, X } from "lucide-react";
import { formatExactPrice } from "@/lib/cart/context";
import "./carousel-hotspots.css";

export interface CarouselHotspot {
  pieceId: string;
  name: string;
  priceCents: number;
  merchantName: string;
}

export interface CarouselHotspotsProps {
  items: CarouselHotspot[];
  selectedPieceId?: string;
  onSelect: (pieceId: string, trigger: HTMLButtonElement) => void;
}

/** These tags describe the current basket, not segmented regions in the inspiration image. */
export function CarouselHotspots({ items, selectedPieceId, onSelect }: CarouselHotspotsProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  if (!items.length) return null;

  return <div className="look-hotspots" data-carousel-interaction>
    <button ref={toggle} type="button" className="look-hotspots-toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((value) => !value)}>
      {open ? <X size={15} aria-hidden="true" /> : <ShoppingBag size={15} aria-hidden="true" />}
      {open ? "Hide pieces" : "Shop pieces"}<span>{items.length}</span>
    </button>
    <div id={listId} className="look-hotspots-basket" hidden={!open} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); toggle.current?.focus(); }
    }}>
      <p>Your selected pieces</p>
      <ul aria-label="Products selected for this look">
        {items.map((item) => <li key={item.pieceId}>
          <button type="button" className="look-hotspot" aria-label={`Inspect ${item.name}, ${formatExactPrice(item.priceCents)}, ${item.merchantName}`} aria-pressed={selectedPieceId === item.pieceId} onClick={(event) => onSelect(item.pieceId, event.currentTarget)}>
            <span className="look-hotspot-name">{item.name}</span>
            <span className="look-hotspot-meta"><span>{formatExactPrice(item.priceCents)}</span><span>{item.merchantName}</span></span>
          </button>
        </li>)}
      </ul>
    </div>
  </div>;
}
