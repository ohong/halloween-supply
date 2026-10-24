"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { formatPrice } from "@/lib/cart/context";
import { Chevron } from "@/components/icons";
import { ProductImage } from "./product-image";
import { useSelection } from "./selection";

/**
 * Knolled flat-lay first (the processed image when it exists, else a CSS grid of the
 * current picks), then one slide per selected product. Swipe = CSS scroll-snap.
 */
export function Carousel({ flatlay, flatlayAlt }: { flatlay: string | null; flatlayAlt: string }) {
  const { view, selectedOption, focus } = useSelection();
  const viewport = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const options = view.pieces.map((piece) => ({ piece, option: selectedOption(piece) }));
  const total = options.length + 1;

  const goTo = useCallback((next: number) => {
    const el = viewport.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clamped = Math.max(0, Math.min(next, total - 1));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
  }, [total]);

  const frame = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = viewport.current;
      if (el && el.clientWidth > 0) setIndex(Math.round(el.scrollLeft / el.clientWidth));
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  useEffect(() => {
    if (!focus) return;
    const at = view.pieces.findIndex((p) => p.piece.id === focus.pieceId);
    if (at >= 0) goTo(at + 1);
  }, [focus, view.pieces, goTo]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") { e.preventDefault(); goTo(index + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); goTo(index - 1); }
    else if (e.key === "Home") { e.preventDefault(); goTo(0); }
    else if (e.key === "End") { e.preventDefault(); goTo(total - 1); }
  };

  const cols = options.length > 4 ? 3 : 2;
  return (
    <div className="carousel" role="region" aria-roledescription="carousel" aria-label={`${view.costume.name} pieces`}>
      <div ref={viewport} className="carousel-viewport" tabIndex={0} onScroll={onScroll} onKeyDown={onKeyDown} aria-label="Product photos. Use the left and right arrow keys to browse.">
        <div className="slide" role="group" aria-roledescription="slide" aria-label={`1 of ${total}: all pieces`}>
          {flatlay ? (
            <ProductImage src={flatlay} alt={flatlayAlt} sizes="(max-width: 999px) 100vw, 55vw" className="slide-cover" preload />
          ) : (
            <div className="knoll" style={{ "--cols": cols } as React.CSSProperties}>
              {options.map(({ piece, option }) => (
                <div className="knoll-item" key={piece.piece.id}>
                  <ProductImage src={option.product.image} alt={`${piece.piece.name}: ${option.product.title}`} sizes="(max-width: 999px) 33vw, 18vw" />
                </div>
              ))}
            </div>
          )}
          <p className="slide-label mono"><span>The full set</span><span>{options.length} pieces</span></p>
        </div>
        {options.map(({ piece, option }, i) => (
          <div className="slide" key={piece.piece.id} role="group" aria-roledescription="slide" aria-label={`${i + 2} of ${total}: ${piece.piece.name}`}>
            <ProductImage src={option.product.image} alt={option.product.title} sizes="(max-width: 999px) 100vw, 55vw" className="slide-img" />
            <p className="slide-label mono"><span>{piece.piece.name}</span><span>{option.merchant.name} · {formatPrice(option.product.priceCents)}</span></p>
          </div>
        ))}
      </div>
      <div className="carousel-controls">
        <div className="dots">
          {Array.from({ length: total }, (_, i) => (
            <button key={i} type="button" className="dot" aria-label={i === 0 ? "Show the full set" : `Show ${options[i - 1].piece.piece.name}`} aria-current={i === index} onClick={() => goTo(i)} />
          ))}
        </div>
        <span className="carousel-count mono" aria-hidden="true">{index + 1} / {total}</span>
        <div className="arrows">
          <button type="button" className="arrow-btn" aria-label="Previous photo" onClick={() => goTo(index - 1)} disabled={index === 0}><Chevron dir="left" /></button>
          <button type="button" className="arrow-btn" aria-label="Next photo" onClick={() => goTo(index + 1)} disabled={index === total - 1}><Chevron dir="right" /></button>
        </div>
      </div>
    </div>
  );
}
