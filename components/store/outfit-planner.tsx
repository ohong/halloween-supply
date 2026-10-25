"use client";

import type { CostumeView } from "@/lib/types";
import { compareOutfits, type OutfitPlan, type PieceUse, type ShoppingBrief } from "@/lib/outfits";
import { formatPrice, useCart } from "@/lib/cart/context";
import { ProductImage } from "./product-image";
import "./outfit-planner.css";

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
  const sizeKinds = [...new Set(costume.pieces.map(({ piece }) => piece.sizeKind))].filter((kind) => kind !== "one_size");
  return <section id="outfit-planner" className={"outfit-planner-planner"} aria-labelledby="planner-title">
    <div className={"outfit-planner-intro"}><p className={"outfit-planner-eyebrow"}>Make it your own</p><h2 id="planner-title">One look. Three ways to build it.</h2><p>Start with your wardrobe. We’ll compare the rest.</p></div>
    <div className={"outfit-planner-brief"}>
      <fieldset className={"outfit-planner-fields"}><legend>Your shopping brief</legend>
        <label>Budget for new pieces ($)<input type="number" min="0" max="100000" step="0.01" inputMode="decimal" placeholder="No limit" value={brief.budget} onChange={(e) => onBrief({ ...brief, budget: e.target.value })} /></label>
        <label>Event date<input type="date" value={brief.eventDate} onChange={(e) => onBrief({ ...brief, eventDate: e.target.value })} /></label>
        <label>What matters most?<select value={brief.preference} onChange={(e) => onBrief({ ...brief, preference: e.target.value as ShoppingBrief["preference"] })}><option value="styling">The original styling</option><option value="local">Bay Area shops</option><option value="secondhand">Vintage & secondhand</option></select></label>
        {sizeKinds.map((kind) => <label key={kind}>{kind === "apparel" ? "Clothing" : kind[0].toUpperCase() + kind.slice(1)} size<input maxLength={40} placeholder="Any / not sure" value={brief.sizes[kind] ?? ""} onChange={(e) => onBrief({ ...brief, sizes: { ...brief.sizes, [kind]: e.target.value } })} /></label>)}
        <p className={"outfit-planner-note"}>Sizes match the merchant’s labels exactly. Unknown sizes stay visible for you to check. {brief.eventDate ? "Your event date is noted below; delivery is not confirmed." : "Delivery dates are not confirmed."}</p>
      </fieldset>
      <fieldset className={"outfit-planner-wardrobe"}><legend>What do you already have?</legend>
        {costume.pieces.map(({ piece }) => <label key={piece.id}><span>{piece.name}{!piece.required && <small>Optional finishing touch</small>}</span><select aria-label={`Use for ${piece.name}`} value={uses[piece.id] ?? "buy"} onChange={(e) => onUse(piece.id, e.target.value as PieceUse)}><option value="buy">Buy it</option><option value="owned">Own it</option>{!piece.required && <option value="skip">Skip it</option>}</select></label>)}
        <p className={"outfit-planner-note"}>Owned and skipped pieces cost $0 in these plans and stay out of your cart.</p>
      </fieldset>
    </div>
    <div className={"outfit-planner-comparisons"} aria-live="polite" aria-atomic="true">
      {plans.map((plan, i) => <article className={"outfit-planner-plan"} key={plan.id} aria-labelledby={`plan-${plan.id}`}>
        <div className={"outfit-planner-planHead"}><span className={"outfit-planner-number"}>0{i + 1}</span><h3 id={`plan-${plan.id}`}>{plan.title}</h3></div>
        <p className={"outfit-planner-price"}>{formatPrice(plan.total)}<span>pieces subtotal</span></p>
        <p className={"outfit-planner-explanation"}>{plan.explanation}</p>
        <div className={"outfit-planner-contactSheet"}>{plan.lines.filter((line) => line.use !== "skip").map((line) => <div key={line.view.piece.id} title={line.option?.product.title ?? line.view.piece.name}>{line.option ? <ProductImage src={line.option.product.image} alt={line.option.product.title} /> : <span>{line.use === "owned" ? "Your own" : "No match"}</span>}</div>)}</div>
        <ul className={"outfit-planner-lines"}>{plan.lines.map((line) => <li key={line.view.piece.id}><span>{line.view.piece.name}<small>{line.use === "owned" ? "From your wardrobe" : line.use === "skip" ? "Skipped" : line.option?.merchant.name ?? "No matching option"}</small></span><span>{line.use === "buy" && line.option ? formatPrice(line.option.product.priceCents) : "—"}</span></li>)}</ul>
        <p className={"outfit-planner-note"}>{plan.shops} {plan.shops === 1 ? "shop" : "shops"} · Shipping and tax extra.{brief.eventDate && ` Needed by ${brief.eventDate}. Confirm delivery with each shop.`}</p>
        {plan.missing.length > 0 && <p className={"outfit-planner-warning"}>Incomplete: no matching {plan.missing.join(", ").toLowerCase()}.</p>}
        {plan.overBudget && <p className={"outfit-planner-warning"}>Over budget by {formatPrice(plan.total - Math.round(Number(brief.budget) * 100))}. This is the lowest-cost matching combination.</p>}
        {plan.unknownSizes.length > 0 && <p className={"outfit-planner-note"}>Check sizes: {plan.unknownSizes.join(", ")}.</p>}
        {plan.unknownStock && <p className={"outfit-planner-note"}>Some stock is unconfirmed.</p>}
        {i > 0 && plans[0].lines.every((line, index) => line.option?.product.id === plan.lines[index].option?.product.id) && <p className={"outfit-planner-note"}>Same pieces as Lowest cost for this brief.</p>}
        <button className="btn btn-ghost btn-block" type="button" disabled={!cart.ready || plan.missing.length > 0 || plan.overBudget} onClick={() => onApply(plan)}>Use this outfit</button>
      </article>)}
    </div>
  </section>;
}
