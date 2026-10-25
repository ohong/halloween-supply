"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { formatPrice } from "@/lib/cart/context";
import type { ProductOption } from "@/lib/types";
import { AssemblyImage, AssemblyPlaceholder, AssemblyStatus } from "./assembly-status";
import "./shop-for-me.css";

export type SourcingPiece = {
  id: string;
  name: string;
  queries: readonly string[];
  options: ProductOption[];
};
const DURATION = 18_000;
const TILT = [-3, 2, -1.5, 2.5, -2, 1];

function getPick(piece: SourcingPiece) {
  return piece.options
    .map((option, index) => ({ option, index }))
    .filter(
      ({ option }) =>
        option.product.availability !== "out_of_stock" &&
        Number.isFinite(option.product.priceCents) &&
        option.product.priceCents >= 0,
    )
    .sort(
      (a, b) =>
        a.option.product.priceCents - b.option.product.priceCents ||
        a.option.pick.rank - b.option.pick.rank,
    )[0];
}

/** Replays saved sourcing decisions; no live search or model call happens on click. */
export function ShopForMe({
  pieces,
  onComplete,
}: {
  pieces: SourcingPiece[];
  onComplete?: (choices: Record<string, number>) => void;
}) {
  const [status, setStatus] = useState<"idle" | "running" | "complete">("idle");
  const [elapsed, setElapsed] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const onFinish = useRef(onComplete);
  const picks = useMemo(
    () => pieces.map((piece) => ({ piece, pick: getPick(piece) })),
    [pieces],
  );
  const choices = useMemo(
    () =>
      Object.fromEntries(
        picks.flatMap(({ piece, pick }) =>
          pick ? [[piece.id, pick.index]] : [],
        ),
      ),
    [picks],
  );
  const found = picks.filter(({ pick }) => pick);
  const total = found.reduce(
    (sum, { pick }) => sum + pick!.option.product.priceCents,
    0,
  );
  const supplierCount = new Set(
    pieces.flatMap((piece) => piece.options.map(({ merchant }) => merchant.id)),
  ).size;
  const phase =
    elapsed < 2200 ? 0 : elapsed < 10_500 ? 1 : elapsed < 15_000 ? 2 : 3;
  const assembled = status === "complete" || phase > 1
    ? pieces.length
    : Math.max(0, Math.floor(((elapsed - 2200) / 8300) * pieces.length));
  const active = pieces[Math.min(pieces.length - 1, assembled)];
  const ready = picks.slice(0, assembled).filter(({ pick }) => pick).length;
  const missing = picks.slice(0, assembled).filter(({ pick }) => !pick).length;

  useEffect(() => {
    onFinish.current = onComplete;
  }, [onComplete]);
  useEffect(() => {
    if (status === "idle") return;
    panel.current?.focus({ preventScroll: true });
    if (status === "complete") return;
    if (window.matchMedia("(max-width: 959px)").matches) {
      panel.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    }
    const started = performance.now();
    // Wall time prevents background-tab throttling from extending the replay.
    const timer = window.setInterval(() => {
      const next = Math.min(DURATION, performance.now() - started);
      setElapsed(next);
      if (next === DURATION) {
        window.clearInterval(timer);
        setStatus("complete");
        onFinish.current?.(choices);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [status, choices]);

  function start() {
    setElapsed(0);
    setStatus("running");
  }
  function finish() {
    setElapsed(DURATION);
    setStatus("complete");
    onFinish.current?.(choices);
  }
  function cancel() {
    setStatus("idle");
    window.requestAnimationFrame(() =>
      trigger.current?.focus({ preventScroll: true }),
    );
  }

  if (status === "idle")
    return (
      <button
        ref={trigger}
        type="button"
        className="btn btn-block shop-for-me-launch"
        onClick={start}
      >
        <Icon kind="search" />
        Shop for me
        <Icon kind="arrow" />
      </button>
    );
  return (
    <section
      className={`shop-for-me-sequence ${status === "complete" ? "is-complete" : ""}`}
      ref={panel}
      tabIndex={-1}
      aria-label={status === "complete" ? "Sourcing results" : "Costume sourcing replay"}
    >
      <div className="shop-for-me-sequence-head">
        <div className="shop-for-me-activity">
          <Icon kind={status === "complete" ? "check" : "search"} />
          <span>Saved sourcing replay</span>
        </div>
        {status === "running" && <button type="button" className="shop-for-me-cancel" onClick={cancel}>Cancel</button>}
      </div>
      <div className="shop-for-me-stage-heading" aria-live="polite" aria-atomic="true">
        <h2>{status === "complete"
          ? found.length === pieces.length && found.length ? "Your picks are ready" : found.length ? `${found.length} of ${pieces.length} pieces sourced` : "No sources saved yet"
          : ["First, the essentials.", "A source for every piece.", "A closer look at the prices.", "Bringing the look together."][phase]}</h2>
        <p>{status === "complete"
          ? found.length ? `${formatPrice(total)} before shipping and tax. Select a piece to visit its shop.` : "Supplier picks will appear when they’re added to the catalog."
          : phase === 1 && active ? `${active.name} · ${active.options.length} saved ${active.options.length === 1 ? "option" : "options"}`
          : ["Making room for each piece in the look.", "", "Choosing the lowest listed prices. Sold-out options are excluded.", "Your assembled look stays here, ready to shop."][phase]}</p>
      </div>
      <AssemblyStatus found={ready} total={pieces.length} missing={missing} running={status === "running"} />
      {pieces.length > 0 && <ul className="shop-for-me-lay" aria-label="Assembling your costume">
        {picks.map(({ piece, pick }, i) => {
          const resolved = i < assembled;
          return <li key={piece.id} className="shop-for-me-piece" data-state={resolved ? pick ? "found" : "missing" : "looking"} style={{ "--r": `${TILT[i % TILT.length]}deg` } as CSSProperties}>
            <div className="shop-for-me-piece-frame">
              {resolved && pick ? <a href={pick.option.product.url} target="_blank" rel="noopener noreferrer" aria-label={`${piece.name}: ${pick.option.product.title}, ${formatPrice(pick.option.product.priceCents)} at ${pick.option.merchant.name} (opens in a new tab)`}>
                <AssemblyImage src={pick.option.product.cutout ?? pick.option.product.merchantImage ?? pick.option.product.image} alt={pick.option.product.title} cutout={Boolean(pick.option.product.cutout)} />
              </a> : <AssemblyPlaceholder state={resolved ? "missing" : "looking"} index={i} />}
            </div>
            <div className="shop-for-me-piece-caption">
              <span>{piece.name}</span>
              {resolved && pick ? <><small>{pick.option.merchant.name}</small><strong>{formatPrice(pick.option.product.priceCents)}</strong></> : <small>{resolved ? "No saved source" : "Saved match pending"}</small>}
            </div>
          </li>;
        })}
      </ul>}
      <div className="shop-for-me-sequence-foot">
        <span>No live search{supplierCount > 0 && ` · ${supplierCount} saved ${supplierCount === 1 ? "supplier" : "suppliers"}`}</span>
        {status === "running" ? <button type="button" onClick={finish}>Show picks now <Icon kind="arrow" /></button> : <button type="button" onClick={start}>Replay sourcing <Icon kind="replay" /></button>}
      </div>
    </section>
  );
}

function Icon({ kind }: { kind: "search" | "check" | "arrow" | "replay" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "search" && (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 4 4" />
        </>
      )}
      {kind === "check" && <path d="m5 12 4 4L19 6" />}
      {kind === "arrow" && <path d="M4 12h16m-6-6 6 6-6 6" />}
      {kind === "replay" && <path d="M3 10a9 9 0 1 1 1 7M3 4v6h6" />}
    </svg>
  );
}
