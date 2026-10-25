"use client";

import { useEffect, useRef, useState } from "react";
import type { CostumeView } from "@/lib/types";
import { compareOutfits, requestedSize, type OutfitPlan, type PieceUse, type ShoppingBrief } from "@/lib/outfits";
import { formatPrice, useCart } from "@/lib/cart/context";
import { ProductImage } from "./product-image";
import "./outfit-planner.css";

type Recommendation =
  | { key: string; status: "loading" }
  | { key: string; status: "ready"; plan: OutfitPlan }
  | { key: string; status: "error"; message: string };

export function OutfitPlanner({ costume, brief, uses, onBrief, onUse, onApply }: {
  costume: CostumeView;
  brief: ShoppingBrief;
  uses: Record<string, PieceUse>;
  onBrief: (brief: ShoppingBrief) => void;
  onUse: (id: string, use: PieceUse) => void;
  onApply: (plan: OutfitPlan) => void;
}) {
  const cart = useCart();
  const plans = compareOutfits(costume, brief, uses);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const controller = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const key = JSON.stringify([costume.costume.slug, brief, uses]);
  const current = recommendation?.key === key ? recommendation : null;
  const busy = current?.status === "loading";
  const sizedPieces = costume.pieces.filter(({ piece }) => piece.sizeKind !== "one_size");

  // A brief change makes an in-flight recommendation obsolete.
  useEffect(() => () => controller.current?.abort(), [key]);

  async function styleOutfit() {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const id = ++requestId.current;
    setRecommendation({ key, status: "loading" });
    try {
      const response = await fetch("/api/outfits", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costumeSlug: costume.costume.slug, brief, uses }),
        signal: abort.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Your outfit could not be assembled. Please try again.");
      if (!body.plan || !Array.isArray(body.plan.lines) || body.method !== "decisions") throw new Error("Your outfit could not be read. Please try again.");
      if (id === requestId.current) setRecommendation({ key, status: "ready", plan: body.plan });
    } catch (error) {
      if (!abort.signal.aborted && id === requestId.current) setRecommendation({ key, status: "error", message: error instanceof Error ? error.message : "Your outfit could not be assembled. Please try again." });
    }
  }

  return <section id="outfit-planner" className="outfit-planner-planner" aria-labelledby="planner-title">
    <div className="outfit-planner-intro"><h2 id="planner-title">Build your costume</h2></div>
    <div className="outfit-planner-brief">
      <fieldset className="outfit-planner-fields"><legend>Your budget & preferences</legend>
        <label>Budget for new pieces ($)<input type="number" min="0" max="100000" step="0.01" inputMode="decimal" placeholder="No limit" value={brief.budget} onChange={(event) => onBrief({ ...brief, budget: event.target.value })} /></label>
        <label>Event date<input type="date" value={brief.eventDate} onChange={(event) => onBrief({ ...brief, eventDate: event.target.value })} /></label>
        <label>What matters most?<select value={brief.preference} onChange={(event) => onBrief({ ...brief, preference: event.target.value as ShoppingBrief["preference"] })}><option value="styling">The original styling</option><option value="local">Bay Area shops</option><option value="secondhand">Vintage & secondhand</option></select></label>
        {sizedPieces.map(({ piece }) => <label key={piece.id}>{piece.name} size<input maxLength={40} placeholder="Not sure" value={requestedSize(brief, piece)} onChange={(event) => onBrief({ ...brief, pieceSizes: { ...brief.pieceSizes, [piece.id]: event.target.value } })} /></label>)}
        <label className="outfit-planner-notes">Styling notes<input maxLength={500} placeholder="Prioritize the cape; keep the basics simple." value={brief.notes ?? ""} onChange={(event) => onBrief({ ...brief, notes: event.target.value })} /></label>
        <p className="outfit-planner-note">Budget covers pieces only. Shipping and tax are extra. Sizes use each merchant’s labels; delivery is unconfirmed.</p>
      </fieldset>
      <fieldset className="outfit-planner-wardrobe"><legend>What do you already have?</legend>
        {costume.pieces.map(({ piece }) => <label key={piece.id}><span>{piece.name}</span><select aria-label={"Use for " + piece.name} value={uses[piece.id] ?? "buy"} onChange={(event) => onUse(piece.id, event.target.value as PieceUse)}><option value="buy">Buy it</option><option value="owned">Own it</option>{!piece.required && <option value="skip">Skip it</option>}</select></label>)}
      </fieldset>
    </div>
    <button className="btn outfit-stylist-submit" type="button" disabled={busy || !cart.ready} onClick={styleOutfit}>{busy ? "Comparing outfits…" : "Style my outfit"}<span aria-hidden="true">→</span></button>
    <div className="outfit-stylist-result" aria-live="polite" aria-busy={busy}>
      {busy && <p className="outfit-planner-note">Balancing the look, sizes, and your budget.</p>}
      {current?.status === "error" && <p role="alert" className="outfit-planner-warning">{current.message}</p>}
      {current?.status === "ready" && <PlanCard plan={current.plan} brief={brief} ready={cart.ready} onApply={onApply} recommended />}
    </div>
    <details className="outfit-planner-other"><summary>Compare lowest cost, closest match & fewest shops</summary>
      <div className="outfit-planner-comparisons">{plans.map((plan) => <PlanCard key={plan.id} plan={plan} brief={brief} ready={cart.ready} onApply={onApply} />)}</div>
    </details>
  </section>;
}

function PlanCard({ plan, brief, ready, onApply, recommended = false }: {
  plan: OutfitPlan; brief: ShoppingBrief; ready: boolean; onApply: (plan: OutfitPlan) => void; recommended?: boolean;
}) {
  return <article className={"outfit-planner-plan" + (recommended ? " outfit-planner-recommended" : "")}>
    <div className="outfit-planner-planHead"><h3>{plan.title}</h3><p className="outfit-planner-price">{formatPrice(plan.total)}<span>pieces subtotal</span></p></div>
    <p className="outfit-planner-explanation">{plan.explanation}</p>
    <div className="outfit-planner-contactSheet">{plan.lines.filter((line) => line.use !== "skip").map((line) => <div key={line.view.piece.id} title={line.option?.product.title ?? line.view.piece.name}>{line.option ? <ProductImage src={line.option.product.image} alt={line.option.product.title} /> : <span>{line.use === "owned" ? "Your own" : "No match"}</span>}</div>)}</div>
    <ul className="outfit-planner-lines">{plan.lines.map((line) => <li key={line.view.piece.id}><span>{line.view.piece.name}<small>{line.use === "owned" ? "From your wardrobe" : line.use === "skip" ? "Skipped" : line.option?.product.title ?? "No matching option"}</small></span><span>{line.use === "buy" && line.option ? <>{line.option.pick.priceTier} · {formatPrice(line.option.product.priceCents)}</> : "—"}</span></li>)}</ul>
    <p className="outfit-planner-note">{plan.shops} {plan.shops === 1 ? "shop" : "shops"} · Shipping and tax extra.{brief.eventDate && " Confirm delivery before " + brief.eventDate + "."}</p>
    {plan.missing.length > 0 && <p className="outfit-planner-warning">No matching {plan.missing.join(", ").toLowerCase()}.</p>}
    {plan.overBudget && <p className="outfit-planner-warning">The lowest matching total is {formatPrice(plan.total)}, {formatPrice(plan.total - Math.round(Number(brief.budget) * 100))} over budget.</p>}
    {plan.unknownSizes.length > 0 && <p className="outfit-planner-note">Check sizes: {plan.unknownSizes.join(", ")}.</p>}
    {plan.unknownStock && <p className="outfit-planner-note">Some stock is unconfirmed.</p>}
    <button className="btn btn-ghost" type="button" disabled={!ready || plan.missing.length > 0 || plan.overBudget} onClick={() => onApply(plan)}>Use this outfit</button>
  </article>;
}
