"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { ProductImage } from "./product-image";
import { CarouselHotspots, type CarouselHotspotsProps } from "./carousel-hotspots";
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
  items: { key: string; slideKey: string; name: string; src: string; alt: string; scale: number; photo: boolean }[];
});

export function Carousel({ slides, hotspots }: { slides: Slide[]; hotspots?: CarouselHotspotsProps }) {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const trackId = useId();
  const [selectedKey, setSelectedKey] = useState(slides[0]?.key);
  const selectedKeyRef = useRef(selectedKey);
  const trackWidth = useRef(0);
  const aligning = useRef(false);
  const last = slides.length - 1;
  const current = Math.max(0, slides.findIndex((slide) => slide.key === selectedKey));
  const wornIndex = slides.findIndex((slide) => slide.kind === "image" && slide.editorial);
  const piecesIndex = slides.findIndex((slide) => slide.kind === "flatlay");
  const slideOrder = JSON.stringify(slides.map((slide) => slide.key));

  const go = useCallback((to: number) => {
    const el = track.current;
    if (!el || last < 0) return;
    const next = Math.min(Math.max(to, 0), last);
    // Instant navigation keeps repeated clicks and key presses responsive.
    el.scrollTo({ left: next * el.clientWidth, behavior: "instant" });
    selectedKeyRef.current = slides[next].key;
    setSelectedKey(slides[next].key);
  }, [last, slides]);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let frame = 0;
    function alignSelectedSlide() {
      if (!el || !el.clientWidth) return;
      const selected = Array.from(el.children).findIndex((slide) => slide.getAttribute("data-slide-key") === selectedKeyRef.current);
      // Keep the pieces overview selected when choices add or remove slides.
      aligning.current = true;
      trackWidth.current = el.clientWidth;
      el.scrollTo({ left: Math.max(0, selected) * el.clientWidth, behavior: "instant" });
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { aligning.current = false; });
    }
    alignSelectedSlide();
    const observer = new ResizeObserver(alignSelectedSlide);
    observer.observe(el);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [slideOrder]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("[data-carousel-interaction]")) return;
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
      {wornIndex >= 0 && piecesIndex >= 0 && <div className="carousel-views" role="group" aria-label="Gallery views">
        <button type="button" className="carousel-view" aria-pressed={current === wornIndex} aria-controls={trackId} onClick={() => go(wornIndex)}>Worn look</button>
        <button type="button" className="carousel-view" aria-pressed={current === piecesIndex} aria-controls={trackId} onClick={() => go(piecesIndex)}>Pieces</button>
      </div>}
      <div className="carousel-frame">
        <div className="carousel-track" id={trackId} ref={track} tabIndex={0} aria-label="Use left and right arrow keys to change images"
          onKeyDown={(event) => {
            if (event.key === "Home") { event.preventDefault(); go(0); }
            if (event.key === "End") { event.preventDefault(); go(last); }
          }}
          onScroll={(event) => {
            const el = event.currentTarget;
            // Layout scroll events must not replace the user's selected slide.
            if (!el.clientWidth || el.clientWidth !== trackWidth.current || aligning.current) return;
            const next = Math.min(last, Math.max(0, Math.round(el.scrollLeft / el.clientWidth)));
            if (!slides[next]) return;
            selectedKeyRef.current = slides[next].key;
            setSelectedKey(slides[next].key);
          }}>
          {slides.map((slide, i) => (
            <figure className={`slide${slide.kind === "image" && slide.editorial ? " slide-costume" : ""}`} key={slide.key} data-slide-key={slide.key} inert={i !== current} aria-hidden={i !== current} aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}`}>
              <SlideContent slide={slide} preload={i === 0} onInspectPiece={hotspots?.onSelect} onSelectPiece={(key) => {
                go(slides.findIndex((candidate) => candidate.key === key));
                track.current?.focus({ preventScroll: true });
              }} />
              {slide.key === "complete-look" && current === i && hotspots && <CarouselHotspots {...hotspots} />}
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

function SlideContent({ slide, preload, onSelectPiece, onInspectPiece }: { slide: Slide; preload: boolean; onSelectPiece: (key: string) => void; onInspectPiece?: CarouselHotspotsProps["onSelect"] }) {
  if (slide.kind === "flatlay") return <div className="carousel-flatlay" aria-label="Selected pieces laid out together" style={{ gridTemplateRows: `repeat(${Math.ceil(slide.items.length / 2)}, minmax(0, 1fr))` }}>
    {slide.items.map((item, at) => <button type="button" key={item.key} className={`carousel-piece${item.photo ? " carousel-piece-photo" : ""}`} aria-label={`${onInspectPiece ? "Inspect" : "View"} ${item.name}`} onClick={(event) => onInspectPiece ? onInspectPiece(item.key, event.currentTarget) : onSelectPiece(item.slideKey)} style={at === slide.items.length - 1 && slide.items.length % 2 === 1 ? { gridColumn: "1 / -1", width: "50%", justifySelf: "center" } : undefined}>
      <span className="carousel-piece-image" style={{ transform: `scale(${item.scale})` }}><ProductImage src={item.src} alt={item.alt} /></span>
      <span className="carousel-piece-name">{item.name}</span>
    </button>)}
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
