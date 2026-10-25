"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AssistantPanel } from "@/components/assistant/panel";
import { formatPrice, useCart } from "@/lib/cart/context";
import { toCartItem } from "@/lib/cart/item";
import type { CostumeView, PieceView, ProductOption } from "@/lib/types";
import { SaveLook } from "@/components/saved-looks";
import { Carousel, type Slide } from "./carousel";
import { suggestConsolidation } from "./consolidate";
import { ProductImage } from "./product-image";
import { ShopForMe } from "./shop-for-me";
import { flatlayScale } from "@/lib/products/flatlay";
import { OutfitPlanner } from "./outfit-planner";
import { VirtualTryOn } from "./virtual-try-on";
import { emptyBrief, sizeMatches, type OutfitPlan, type PieceUse } from "@/lib/outfits";

export function CostumeExperience({ costume, editorial }: { costume: CostumeView; editorial?: { image: string; alt: string } }) {
  const cart = useCart();
  const costumeSlug = costume.costume.slug;
  const ownsCart = cart.costumeSlug === costumeSlug;
  const pieces = useMemo(() => [...costume.pieces].sort((a, b) => a.piece.order - b.piece.order), [costume.pieces]);
  // Chosen option index per piece; 0 is the default pick.
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [brief, setBrief] = useState(emptyBrief);
  const [uses, setUses] = useState<Record<string, PieceUse>>({});
  const [applied, setApplied] = useState("");
  const sourcingPieces = useMemo(() => pieces.map(({ piece, options }) => ({
    id: piece.id, name: piece.name, queries: piece.queries, options,
  })), [pieces]);

  function selectedIndex(view: PieceView) {
    const selected = chosen[view.piece.id];
    if (selected !== undefined) return selected;
    const cartProduct = ownsCart ? cart.items.find((line) => line.pieceId === view.piece.id)?.productId : undefined;
    const savedIndex = view.options.findIndex(({ product }) => product.id === cartProduct);
    return savedIndex >= 0 ? savedIndex : 0;
  }

  const picked = new Map<string, ProductOption | undefined>(
    pieces.map((view) => [view.piece.id, view.options[selectedIndex(view)] ?? view.options[0]]),
  );

  const flatlayItems = pieces.flatMap((view) => {
    const option = picked.get(view.piece.id);
    return option?.product.cutout ? [{ key: view.piece.id, src: option.product.cutout, alt: `${view.piece.name}: ${option.product.title}`, scale: flatlayScale(view.piece) }] : [];
  });

  const slides: Slide[] = [
    flatlayItems.length > 0 && flatlayItems.length === pieces.length
      ? { kind: "flatlay", key: "flat-lay", items: flatlayItems, caption: `${costume.costume.name} · ${flatlayItems.length} selected pieces` }
      : { kind: "image", key: "flat-lay", src: costume.costume.image, alt: costume.costume.alt, caption: `${costume.costume.name} · the complete look`, local: costume.costume.image.startsWith("/") },
    ...pieces.flatMap((view) => {
      const option = picked.get(view.piece.id);
      return option ? [{ kind: "image" as const, key: `${view.piece.id}:${option.product.id}`, src: option.product.image, alt: option.product.title, caption: `${view.piece.name} · ${option.merchant.name}` }] : [];
    }),
    ...(editorial ? [{ kind: "image" as const, key: "editorial-reference", src: editorial.image, alt: editorial.alt, caption: `${costume.costume.name} · editorial reference`, local: editorial.image.startsWith("/"), editorial: true }] : []),
  ];

  const pickedOptions = pieces.flatMap((view) => {
    if (uses[view.piece.id] === "owned" || uses[view.piece.id] === "skip") return [];
    const option = picked.get(view.piece.id);
    return option ? [{ view, option }] : [];
  });
  const total = pickedOptions.reduce((sum, { option }) => sum + option.product.priceCents, 0);
  const withinBudget = !brief.budget.trim() || total <= Math.round(Number(brief.budget) * 100);
  const sizesMatch = pickedOptions.every(({ view, option }) => sizeMatches(option, brief.sizes[view.piece.sizeKind] ?? ""));
  const shopCount = new Set(pickedOptions.map(({ option }) => option.merchant.id)).size;
  const needed = pieces.filter(({ piece }) => !uses[piece.id] || uses[piece.id] === "buy");
  const complete = pickedOptions.length > 0 && pickedOptions.length === needed.length && pickedOptions.every(({ option }) => option.product.availability !== "out_of_stock");
  const suggestions = suggestConsolidation(pieces.map((v) => ({ id: v.piece.id, name: v.piece.name, options: v.options })), picked).slice(0, 2);

  function choose(view: PieceView, index: number) {
    if (!view.options[index] || view.options[index].product.availability === "out_of_stock") return;
    setChosen((current) => ({ ...current, [view.piece.id]: index }));
    setApplied("");
    // A piece already in the cart follows the swap.
    if (ownsCart && cart.items.some((line) => line.pieceId === view.piece.id) && (!uses[view.piece.id] || uses[view.piece.id] === "buy")) cart.add(toCartItem(view.piece, view.options[index], brief.sizes[view.piece.sizeKind]?.trim() || null), costumeSlug);
  }

  function addAll() {
    cart.addMany(pickedOptions.map(({ view, option }) => toCartItem(view.piece, option, brief.sizes[view.piece.sizeKind]?.trim() || null)), costumeSlug);
    cart.setOpen(true);
  }

  function setUse(id: string, use: PieceUse) {
    setUses((current) => ({ ...current, [id]: use }));
    setApplied("");
    if (ownsCart && use !== "buy") cart.remove(id);
  }

  function applyPlan(plan: OutfitPlan) {
    setChosen(Object.fromEntries(plan.lines.flatMap(({ view, option }) => option ? [[view.piece.id, view.options.findIndex((candidate) => candidate.product.id === option.product.id)]] : [])));
    for (const { view, option } of plan.lines) {
      if (ownsCart && option && cart.items.some((item) => item.pieceId === view.piece.id)) cart.add(toCartItem(view.piece, option, brief.sizes[view.piece.sizeKind]?.trim() || null), costumeSlug);
    }
    setApplied(`${plan.title} selected. Review your pieces above, or preview them on your photo.`);
  }

  return <div className="costume-layout costume-layout-planned">
    <div className="costume-media"><Carousel slides={slides} /><VirtualTryOn costumeSlug={costumeSlug} selection={pickedOptions.map(({ view, option }) => ({ pieceId: view.piece.id, productId: option.product.id }))} ownedPieceIds={pieces.filter(({ piece }) => uses[piece.id] === "owned").map(({ piece }) => piece.id)} skippedPieceIds={pieces.filter(({ piece }) => uses[piece.id] === "skip").map(({ piece }) => piece.id)} /></div>
    <div className="costume-info">
      <Link href="/" className="back-link">All costumes</Link>
      <h1 className="costume-title">{costume.costume.name}</h1>
      <p className="costume-description">{costume.costume.description}</p>
      <a href="#outfit-planner" className="text-btn outfit-planner-link">Set your budget, use your own pieces & compare outfits ↓</a>

      <ShopForMe pieces={sourcingPieces} onComplete={(choices) => {
        for (const view of pieces) {
          const index = choices[view.piece.id];
          if (index !== undefined) choose(view, index);
        }
      }} />

      {applied && <p className="notice" role="status">{applied}</p>}
      {pickedOptions.length > 0
        ? <div className="whole-costume" id="selected-outfit">
            <button type="button" className="btn btn-block" disabled={!complete || !cart.ready || !withinBudget || !sizesMatch} onClick={addAll}>{Object.values(uses).some((use) => use !== "buy") ? "Add remaining pieces" : "Add whole costume"} · {formatPrice(total)}</button>
            {(!withinBudget || !sizesMatch) && <p className="meta">Your current selections do not match your brief. <a href="#outfit-planner">Choose a matching outfit below.</a></p>}
            <p className="meta">{pickedOptions.length} pieces from {shopCount} {shopCount === 1 ? "shop" : "shops"}. Merchant prices, one checkout.</p>
            {cart.ready && cart.items.length > 0 && !ownsCart && <p className="meta">One costume per cart. Adding this look replaces the pieces in your current cart.</p>}
            {ownsCart && cart.notice && !cart.isOpen && <div className="notice" role="status"><p>{cart.notice}</p><button type="button" className="text-btn" onClick={cart.dismissNotice}>Dismiss</button></div>}
            <button type="button" className="text-btn assistant-size-link" onClick={() => window.dispatchEvent(new Event("halloween:open-assistant"))}>Tell the assistant your sizes →</button>
          </div>
        : <p className="sourcing-note">{needed.length === 0 ? "Your outfit is covered by your wardrobe. Nothing to buy." : "This costume is being sourced. Check back soon."}</p>}

      {suggestions.length > 0 && <p className="fewest-note">
        Fewest shops: {suggestions.map((s) => `${s.merchant.name} also has ${joinList(s.pieceNames)}`).join(". ")}. Swap those to place fewer orders.
      </p>}

      <ul className="piece-list">
        {pieces.map((view) => <PieceRow key={view.piece.id} costumeSlug={costumeSlug} view={view} size={brief.sizes[view.piece.sizeKind]?.trim()} use={uses[view.piece.id] ?? "buy"} index={selectedIndex(view)} onChoose={(i) => choose(view, i)} />)}
      </ul>

      <div className="costume-actions"><SaveLook slug={costume.costume.slug} name={costume.costume.name} showLabel /></div>

      <AssistantPanel costume={costume} onChoose={(pieceId, productId) => {
        setUses((current) => ({ ...current, [pieceId]: "buy" }));
        setApplied("");
        const view = pieces.find(({ piece }) => piece.id === pieceId);
        const index = view?.options.findIndex(({ product }) => product.id === productId) ?? -1;
        if (index >= 0) setChosen((current) => ({ ...current, [pieceId]: index }));
      }} />
    </div>
    <OutfitPlanner costume={costume} brief={brief} uses={uses} onBrief={(next) => { setBrief(next); setApplied(""); }} onUse={setUse} onApply={applyPlan} />
  </div>;
}

function joinList(items: string[]) {
  const lower = items.map((item) => item.toLowerCase());
  return lower.length < 3 ? lower.join(" and ") : `${lower.slice(0, -1).join(", ")} and ${lower[lower.length - 1]}`;
}

function PieceRow({ costumeSlug, view, use, size, index, onChoose }: { costumeSlug: string; view: PieceView; use: PieceUse; size?: string; index: number; onChoose: (index: number) => void }) {
  const cart = useCart();
  const [swapOpen, setSwapOpen] = useState(false);
  const { piece, options } = view;
  const option = options[index] ?? options[0];

  const header = <div className="piece-head">
    <h2 className="piece-name">{piece.name}</h2>
    {!piece.required && <span className="pill">Optional</span>}
    {use !== "buy" && <span className="pill">{use === "owned" ? "From your wardrobe" : "Skipped"}</span>}
  </div>;

  if (!option) {
    return <li className="piece">{header}<p className="sourcing-note">No available pick. Ask the assistant for help.</p></li>;
  }

  const inCart = cart.ready && cart.costumeSlug === costumeSlug && cart.items.some((line) => line.pieceId === piece.id && line.productId === option.product.id);
  const hood = option.neighborhood;

  return <li className="piece">
    {header}
    <div className="piece-main">
      <a href={option.product.url} target="_blank" rel="noopener noreferrer" className="piece-thumb" aria-label={`${option.product.title} at ${option.merchant.name}`}>
        <ProductImage src={option.product.image} alt="" />
      </a>
      <div className="piece-body">
        <p className="piece-title">{option.product.title}</p>
        <p className="piece-merchant">{option.merchant.name}{hood ? ` · ${hood.name}` : ""}</p>
        <div className="piece-tags">
          {option.pick.isLocal && <span className="pill pill-local">Support local</span>}
          {option.pick.isCheapest && <span className="pill">Cheapest</span>}
          {option.product.availability === "out_of_stock" && <span className="pill">Sold out</span>}
        </div>
      </div>
      <p className="piece-price">{formatPrice(option.product.priceCents)}</p>
    </div>

    <details className="why">
      <summary>Why this pick</summary>
      {option.pick.reason && <p>{option.pick.reason}</p>}
      <ul className="pick-facts" aria-label="About this pick">
        {option.pick.path.filter((step) => ["tag", "neighborhood", "region", "price"].includes(step.kind)).map((step, i) => <li key={`${step.kind}-${i}`}>{step.label}</li>)}
      </ul>
    </details>

    <div className="piece-actions">
      <button type="button" className="btn btn-small" disabled={use !== "buy" || !cart.ready || inCart || option.product.availability === "out_of_stock"}
        onClick={() => cart.add(toCartItem(piece, option, size || null), costumeSlug)}>
        {inCart ? "In cart" : "Add to cart"}
      </button>
      {options.length > 1 && <button type="button" className="btn btn-ghost btn-small" aria-expanded={swapOpen} onClick={() => setSwapOpen((open) => !open)}>
        Swap · {options.length - 1} {options.length === 2 ? "alternative" : "alternatives"}
      </button>}
    </div>

    {swapOpen && <div className="swap" role="group" aria-label={`Choose ${piece.name}`}>
      {options.map((candidate, i) => <button type="button" aria-pressed={i === index} key={candidate.product.id} disabled={candidate.product.availability === "out_of_stock"}
        className={`swap-option ${i === index ? "is-current" : ""}`} onClick={() => onChoose(i)}>
        <span className="swap-thumb"><ProductImage src={candidate.product.image} alt="" /></span>
        <span className="swap-label">{i === 0 ? "Our pick" : `Alternative ${i}`}</span>
        <span className="swap-title">{candidate.product.title}</span>
        <span className="swap-meta">{candidate.merchant.name} · {formatPrice(candidate.product.priceCents)}{candidate.pick.isLocal ? " · local" : ""}{candidate.product.availability === "out_of_stock" ? " · sold out" : ""}</span>
      </button>)}
    </div>}
  </li>;
}
