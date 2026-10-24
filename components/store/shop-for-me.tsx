"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatPrice } from "@/lib/cart/context";
import type { ProductOption } from "@/lib/types";
import { ProductImage } from "./product-image";
import "./shop-for-me.css";

export type SourcingPiece = {
  id: string;
  name: string;
  queries: readonly string[];
  options: ProductOption[];
};
const DURATION = 18_000;
const phases = [
  "Break down the look",
  "Find suppliers",
  "Compare prices",
  "Put it together",
];

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
  const active =
    pieces[
      Math.min(
        pieces.length - 1,
        Math.max(0, Math.floor(((elapsed - 2200) / 8300) * pieces.length)),
      )
    ];

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
  if (status === "complete")
    return (
      <section
        className="shop-for-me-complete"
        ref={panel}
        tabIndex={-1}
        aria-label="Sourcing results"
      >
        <div className="shop-for-me-complete-heading" role="status">
          <Icon kind={found.length ? "check" : "search"} />
          <h2>
            {found.length === pieces.length && found.length
              ? "Your picks are ready"
              : found.length
                ? `${found.length} of ${pieces.length} pieces sourced`
                : "No sources saved yet"}
          </h2>
        </div>
        <p className="shop-for-me-result-note">
          {found.length
            ? `${formatPrice(total)} for ${found.length} ${found.length === 1 ? "piece" : "pieces"}. Lowest listed prices in our saved catalog, before shipping and tax.`
            : "The components are ready. Supplier picks will appear here when they’re added to the catalog."}
        </p>
        <button type="button" className="text-btn" onClick={start}>
          Replay sourcing <Icon kind="replay" />
        </button>
      </section>
    );

  return (
    <section
      className="shop-for-me-sequence"
      ref={panel}
      tabIndex={-1}
      aria-label="Costume sourcing replay"
    >
      <div className="shop-for-me-sequence-head">
        <div className="shop-for-me-activity">
          <span className="shop-for-me-activity-dot" />
          <span>Shopping for you</span>
        </div>
        <button type="button" className="shop-for-me-cancel" onClick={cancel}>
          Cancel
        </button>
      </div>
      <div
        className="shop-for-me-progress"
        role="progressbar"
        aria-label="Sourcing progress"
        aria-valuenow={Math.round((elapsed / DURATION) * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ transform: `scaleX(${elapsed / DURATION})` }} />
      </div>
      <ol className="shop-for-me-steps" aria-label="Sourcing steps">
        {phases.map((name, i) => (
          <li
            key={name}
            data-state={i < phase ? "done" : i === phase ? "active" : "waiting"}
            aria-current={i === phase ? "step" : undefined}
          >
            <span className="shop-for-me-step-mark">
              {i < phase ? <Icon kind="check" /> : <span />}
            </span>
            <span>{name}</span>
          </li>
        ))}
      </ol>
      <div
        className="shop-for-me-stage-heading"
        aria-live="polite"
        aria-atomic="true"
      >
        <h2>
          {
            [
              "First, the essentials.",
              "A source for every piece.",
              "A closer look at the prices.",
              "Bringing the look together.",
            ][phase]
          }
        </h2>
      </div>
      <div className="shop-for-me-stage" key={phase}>
        {phase === 0 && (
          <div className="shop-for-me-breakdown">
            {pieces.map((piece, i) => (
              <div
                className="shop-for-me-component"
                key={piece.id}
                style={{ animationDelay: `${i * 65}ms` }}
              >
                <Icon kind="check" />
                <span>{piece.name}</span>
              </div>
            ))}
          </div>
        )}
        {phase === 1 && active && (
          <div className="shop-for-me-search-stage" key={active.id}>
            <div className="shop-for-me-search-field">
              <Icon kind="search" />
              <span>{active.queries[0] ?? active.name}</span>
              <span className="shop-for-me-search-cursor" />
            </div>
            <div className="shop-for-me-source-head">
              <h3>{active.name}</h3>
              <span>
                {active.options.length}{" "}
                {active.options.length === 1 ? "option" : "options"}
              </span>
            </div>
            <div className="shop-for-me-candidates">
              {active.options.length ? (
                active.options.map((option, i) => (
                  <div
                    key={option.product.id}
                    className="shop-for-me-candidate"
                    style={{ animationDelay: `${i * 100}ms` }}
                  >
                    <div className="shop-for-me-source-image">
                      <ProductImage src={option.product.image} alt="" />
                    </div>
                    <div className="shop-for-me-source-name">
                      <span>{option.merchant.name}</span>
                      <small>{option.merchant.domain}</small>
                    </div>
                    <span className="shop-for-me-source-price">
                      {formatPrice(option.product.priceCents)}
                      {option.product.availability === "out_of_stock" && (
                        <small>Sold out</small>
                      )}
                    </span>
                  </div>
                ))
              ) : (
                <div className="shop-for-me-no-sources">
                  <Icon kind="search" />
                  <p>No saved suppliers for this piece yet.</p>
                </div>
              )}
            </div>
            <div className="shop-for-me-component-track">
              {pieces.map((piece) => (
                <span
                  key={piece.id}
                  data-active={piece.id === active.id}
                  aria-label={piece.name}
                />
              ))}
            </div>
          </div>
        )}
        {phase === 2 && (
          <div className="shop-for-me-comparison">
            <div className="shop-for-me-table-head">
              <span>Component</span>
              <span>Lowest listed</span>
            </div>
            {picks.map(({ piece, pick }, i) => {
              const highest = Math.max(
                ...piece.options
                  .filter(
                    ({ product }) => product.availability !== "out_of_stock",
                  )
                  .map(({ product }) => product.priceCents),
              );
              return (
                <div
                  className="shop-for-me-comparison-row"
                  key={piece.id}
                  style={{ animationDelay: `${i * 65}ms` }}
                >
                  <span>
                    {piece.name}
                    <small>
                      {pick ? pick.option.merchant.name : "No saved source"}
                    </small>
                  </span>
                  <span className="shop-for-me-compared-price">
                    {pick && highest > pick.option.product.priceCents && (
                      <small>vs {formatPrice(highest)}</small>
                    )}
                    <strong>
                      {pick ? formatPrice(pick.option.product.priceCents) : "—"}
                    </strong>
                  </span>
                </div>
              );
            })}
            <p className="shop-for-me-comparison-note">
              Comparing saved matches. Sold-out options are excluded.
            </p>
          </div>
        )}
        {phase === 3 && (
          <div className="shop-for-me-assembly">
            {picks.map(({ piece, pick }, i) => (
              <div
                key={piece.id}
                className="shop-for-me-assembly-row"
                style={{ animationDelay: `${i * 140}ms` }}
              >
                <span className="shop-for-me-assembly-mark">
                  <Icon kind={pick ? "check" : "search"} />
                </span>
                <span>
                  {piece.name}
                  <small>
                    {pick
                      ? pick.option.merchant.name
                      : "Awaiting a saved source"}
                  </small>
                </span>
                <span className="shop-for-me-source-price">
                  {pick ? formatPrice(pick.option.product.priceCents) : "—"}
                </span>
              </div>
            ))}
            {found.length > 0 && (
              <div className="shop-for-me-total">
                <span>Pieces subtotal</span>
                <strong>{formatPrice(total)}</strong>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="shop-for-me-sequence-foot">
        <span>
          Saved sourcing replay
          {supplierCount > 0 &&
            ` · ${supplierCount} ${supplierCount === 1 ? "supplier" : "suppliers"}`}
        </span>
        <button type="button" onClick={finish}>
          Show picks now <Icon kind="arrow" />
        </button>
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
