"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ProductImage } from "./product-image";

export type Slide = {
  key: string;
  caption: string;
} & ({
  kind: "image";
  src: string;
  alt: string;
  /** Local flat-lay uses next/image; merchant images use a plain img. */
  local?: boolean;
} | {
  kind: "flatlay";
  items: { key: string; src: string; alt: string }[];
});

export function Carousel({ slides }: { slides: Slide[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const last = slides.length - 1;

  function go(to: number) {
    const el = track.current;
    if (!el) return;
    const next = Math.min(Math.max(to, 0), last);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: next * el.clientWidth, behavior: reducedMotion ? "auto" : "smooth" });
  }

  return <section className="carousel" aria-roledescription="carousel" aria-label="Costume images">
    <div className="carousel-track" ref={track} tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); }
        if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); }
        if (event.key === "Home") { event.preventDefault(); go(0); }
        if (event.key === "End") { event.preventDefault(); go(last); }
      }}
      onScroll={(event) => {
        const el = event.currentTarget;
        setIndex(Math.round(el.scrollLeft / Math.max(el.clientWidth, 1)));
      }}>
      {slides.map((slide, i) => <figure className="slide" key={slide.key} aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}`}>
        {slide.kind === "flatlay"
          ? <div aria-label="Selected pieces laid out together" style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gridTemplateRows: `repeat(${Math.ceil(slide.items.length / 2)}, minmax(0, 1fr))`, gap: "4%", padding: "6% 7% 11%" }}>
              {slide.items.map((item, at) => <div key={item.key} style={{ minWidth: 0, minHeight: 0, ...(at === slide.items.length - 1 && slide.items.length % 2 === 1 ? { gridColumn: "1 / -1", width: "50%", justifySelf: "center" } : {}) }}>
                <ProductImage src={item.src} alt={item.alt} />
              </div>)}
            </div>
          : slide.local
          ? <Image src={slide.src} alt={slide.alt} fill sizes="(min-width: 960px) 50vw, 100vw" preload={i === 0} />
          : <ProductImage src={slide.src} alt={slide.alt} />}
        <figcaption>{slide.caption}</figcaption>
      </figure>)}
    </div>
    {slides.length > 1 && <div className="carousel-controls">
      <button type="button" className="text-btn" onClick={() => go(index - 1)} disabled={index === 0}>Previous</button>
      <span className="carousel-count" aria-live="polite">{Math.min(index + 1, slides.length)} / {slides.length}</span>
      <button type="button" className="text-btn" onClick={() => go(index + 1)} disabled={index >= last}>Next</button>
    </div>}
  </section>;
}
