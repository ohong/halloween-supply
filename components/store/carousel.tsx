"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ProductImage } from "./product-image";
import "./carousel.css";

export type Slide = {
  key: string;
  caption: string;
} & ({
  kind: "image";
  src: string;
  alt: string;
  /** Local images use next/image; merchant photos remain unchanged. */
  local?: boolean;
  editorial?: boolean;
} | {
  kind: "flatlay";
  items: { key: string; src: string; alt: string; scale: number }[];
});

export function Carousel({ slides }: { slides: Slide[] }) {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const last = slides.length - 1;
  const current = Math.min(index, Math.max(last, 0));

  const go = useCallback((to: number) => {
    const el = track.current;
    if (!el) return;
    const next = Math.min(Math.max(to, 0), last);
    // Instant navigation keeps repeated clicks and key presses responsive.
    el.scrollTo({ left: next * el.clientWidth, behavior: "instant" });
    setIndex(next);
  }, [last]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      // Leave typing, dialogs, and controls outside the carousel to their own keys.
      if (target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='dialog'], [role='combobox'], [role='slider']")) return;
      if (target.closest("a, button, [tabindex]") && !root.current?.contains(target)) return;
      const bounds = root.current?.getBoundingClientRect();
      if (!bounds || bounds.bottom <= 0 || bounds.top >= window.innerHeight) return;
      event.preventDefault();
      go(current + (event.key === "ArrowRight" ? 1 : -1));
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [current, go]);

  if (!slides.length) return null;

  return (
    <section ref={root} className="carousel" aria-roledescription="carousel" aria-label="Costume images" aria-keyshortcuts="ArrowLeft ArrowRight">
      <div className="carousel-frame">
        <div className="carousel-track" ref={track} tabIndex={0} aria-label="Use left and right arrow keys to change images"
          onKeyDown={(event) => {
            if (event.key === "Home") { event.preventDefault(); go(0); }
            if (event.key === "End") { event.preventDefault(); go(last); }
          }}
          onScroll={(event) => {
            const el = event.currentTarget;
            setIndex(Math.min(last, Math.max(0, Math.round(el.scrollLeft / Math.max(el.clientWidth, 1)))));
          }}>
          {slides.map((slide, i) => (
            <figure className={`slide${slide.kind === "image" && slide.editorial ? " slide-costume" : ""}`} key={slide.key} aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}`}>
              <SlideContent slide={slide} preload={i === 0} />
            </figure>
          ))}
        </div>
        {slides.length > 1 && <>
          <button type="button" className="carousel-arrow carousel-arrow-prev" aria-label="Previous image" onClick={() => go(current - 1)} disabled={current === 0}>
            <Chevron direction="left" />
          </button>
          <button type="button" className="carousel-arrow carousel-arrow-next" aria-label="Next image" onClick={() => go(current + 1)} disabled={current === last}>
            <Chevron direction="right" />
          </button>
        </>}
      </div>
      <div className="carousel-controls" aria-live="polite" aria-atomic="true">
        <p className="carousel-caption">{slides[current].caption}</p>
        {slides.length > 1 && <span className="carousel-count">{current + 1} / {slides.length}</span>}
      </div>
    </section>
  );
}

function SlideContent({ slide, preload }: { slide: Slide; preload: boolean }) {
  if (slide.kind === "flatlay") return <div aria-label="Selected pieces laid out together" style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gridTemplateRows: `repeat(${Math.ceil(slide.items.length / 2)}, minmax(0, 1fr))`, gap: "4%", padding: "6% 7%" }}>
    {slide.items.map((item, at) => <div key={item.key} style={{ minWidth: 0, minHeight: 0, transform: `scale(${item.scale})`, ...(at === slide.items.length - 1 && slide.items.length % 2 === 1 ? { gridColumn: "1 / -1", width: "50%", justifySelf: "center" } : {}) }}>
      <ProductImage src={item.src} alt={item.alt} />
    </div>)}
  </div>;
  return slide.local
    ? <Image src={slide.src} alt={slide.alt} fill sizes="(min-width: 960px) 50vw, 100vw" preload={preload} />
    : <ProductImage src={slide.src} alt={slide.alt} />;
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={direction === "left" ? "m14 6-6 6 6 6" : "m10 6 6 6-6 6"} />
  </svg>;
}
