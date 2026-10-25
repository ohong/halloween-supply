"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { formatPrice } from "@/lib/cart/context";
import type { PieceView } from "@/lib/types";
import { ProductImage, shot } from "./product-image";
import "./wardrobe-rail.css";

export function WardrobeRail({ view, selectedId, onChoose }: {
  view: PieceView;
  selectedId: string;
  onChoose: (index: number) => void;
}) {
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const options = view.options.map((option, index) => ({ option, index }))
    .sort((a, b) => a.option.product.priceCents - b.option.product.priceCents);

  function measure() {
    const element = track.current;
    if (!element) return;
    setEdges({ start: element.scrollLeft <= 1, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1 });
  }

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function scroll(direction: number) {
    const element = track.current;
    if (!element) return;
    // One option at a time keeps the next comparison visible on small screens.
    const width = element.firstElementChild?.getBoundingClientRect().width ?? element.clientWidth;
    element.scrollBy({ left: direction * (width + 16), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }

  return <section className="wardrobe-rail" aria-label={`Compare ${view.piece.name}`}>
    <div className="wardrobe-rail-tools">
      <p>{options.length} {options.length === 1 ? "option" : "options"} · lowest price first</p>
      <div className="wardrobe-rail-arrows">
        <button type="button" aria-label="Scroll options left" disabled={edges.start} onClick={() => scroll(-1)}><ArrowLeft size={16} aria-hidden="true" /></button>
        <button type="button" aria-label="Scroll options right" disabled={edges.end} onClick={() => scroll(1)}><ArrowRight size={16} aria-hidden="true" /></button>
      </div>
    </div>
    <ul className="wardrobe-rail-track" ref={track} onScroll={measure} aria-label={`Options for ${view.piece.name}`}>
      {options.map(({ option, index }) => {
        const { product, merchant, pick } = option;
        const selected = product.id === selectedId;
        const soldOut = product.availability === "out_of_stock";
        return <li className="wardrobe-rail-slot" key={product.id}>
          <button type="button" className="wardrobe-rail-option" aria-pressed={selected} disabled={soldOut}
            onClick={() => onChoose(index)}
            onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })}>
            <span className="wardrobe-rail-image"><ProductImage src={product.cutout ?? shot(product)} alt="" /></span>
            <span className="wardrobe-rail-choice">{selected ? <><Check size={13} aria-hidden="true" />Selected</> : soldOut ? "Unavailable" : "Choose this piece"}</span>
            <span className="wardrobe-rail-price"><span>{formatPrice(product.priceCents)}</span><span className="wardrobe-rail-tier" aria-label={`Price tier ${pick.priceTier.length} of 3`}>{pick.priceTier}</span></span>
            <span className="wardrobe-rail-title">{product.title}</span>
            <span className="wardrobe-rail-merchant">{merchant.name}{pick.isLocal ? " · Local" : ""}</span>
            <span className="wardrobe-rail-details">{product.sizes.length ? `Sizes: ${product.sizes.join(", ")}` : "Sizes: check merchant"}</span>
            <span className="wardrobe-rail-stock">{soldOut ? "Sold out" : product.availability === "in_stock" ? "In stock in catalog" : "Check stock with merchant"}</span>
          </button>
        </li>;
      })}
    </ul>
    <p className="wardrobe-rail-note">Compare photos and prices. Confirm current sizes and stock with the shop.</p>
  </section>;
}
