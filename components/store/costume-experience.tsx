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

export function CostumeExperience({ costume }: { costume: CostumeView }) {
  const cart = useCart();
  const pieces = useMemo(() => [...costume.pieces].sort((a, b) => a.piece.order - b.piece.order), [costume.pieces]);
  // Chosen option index per piece; 0 is the default pick.
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const sourcingPieces = useMemo(() => pieces.map(({ piece, options }) => ({
    id: piece.id, name: piece.name, queries: piece.queries, options,
  })), [pieces]);

  function selectedIndex(view: PieceView) {
    const selected = chosen[view.piece.id];
    if (selected !== undefined) return selected;
    const cartProduct = cart.items.find((line) => line.pieceId === view.piece.id)?.productId;
    const savedIndex = view.options.findIndex(({ product }) => product.id === cartProduct);
    return savedIndex >= 0 ? savedIndex : 0;
  }

  const picked = new Map<string, ProductOption | undefined>(
    pieces.map((view) => [view.piece.id, view.options[selectedIndex(view)] ?? view.options[0]]),
  );

  const slides: Slide[] = [
    { key: "complete-look", src: costume.costume.image, alt: costume.costume.alt, caption: `${costume.costume.name} · the complete look`, local: costume.costume.image.startsWith("/") },
    ...pieces.flatMap((view) => {
      const option = picked.get(view.piece.id);
      return option ? [{ key: `${view.piece.id}:${option.product.id}`, src: option.product.image, alt: option.product.title, caption: `${view.piece.name} · ${option.merchant.name}` }] : [];
    }),
  ];

  const pickedOptions = pieces.flatMap((view) => {
    const option = picked.get(view.piece.id);
    return option ? [{ view, option }] : [];
  });
  const total = pickedOptions.reduce((sum, { option }) => sum + option.product.priceCents, 0);
  const shopCount = new Set(pickedOptions.map(({ option }) => option.merchant.id)).size;
  const complete = pieces.length > 0 && pickedOptions.length === pieces.length && pickedOptions.every(({ option }) => option.product.availability !== "out_of_stock");
  const suggestions = suggestConsolidation(pieces.map((v) => ({ id: v.piece.id, name: v.piece.name, options: v.options })), picked).slice(0, 2);

  function choose(view: PieceView, index: number) {
    if (!view.options[index] || view.options[index].product.availability === "out_of_stock") return;
    setChosen((current) => ({ ...current, [view.piece.id]: index }));
    // A piece already in the cart follows the swap.
    if (cart.items.some((line) => line.pieceId === view.piece.id)) cart.add(toCartItem(view.piece, view.options[index]));
  }

  function addAll() {
    cart.addMany(pickedOptions.map(({ view, option }) => toCartItem(view.piece, option)));
    cart.setOpen(true);
  }

  return <div className="costume-layout">
    <div className="costume-media"><Carousel slides={slides} /></div>
    <div className="costume-info">
      <Link href="/" className="back-link">All costumes</Link>
      <h1 className="costume-title">{costume.costume.name}</h1>
      <p className="costume-description">{costume.costume.description}</p>

      <ShopForMe pieces={sourcingPieces} onComplete={(choices) => setChosen((current) => ({ ...current, ...choices }))} />

      {pickedOptions.length > 0
        ? <div className="whole-costume">
            <button type="button" className="btn btn-block" disabled={!complete || !cart.ready} onClick={addAll}>Add whole costume · {formatPrice(total)}</button>
            <p className="meta">{pickedOptions.length} pieces from {shopCount} {shopCount === 1 ? "shop" : "shops"}. Merchant prices, one checkout.</p>
            <button type="button" className="text-btn assistant-size-link" onClick={() => window.dispatchEvent(new Event("halloween:open-assistant"))}>Tell the assistant your sizes →</button>
          </div>
        : <p className="sourcing-note">This costume is being sourced. Check back soon.</p>}

      {suggestions.length > 0 && <p className="fewest-note">
        Fewest shops: {suggestions.map((s) => `${s.merchant.name} also has ${joinList(s.pieceNames)}`).join(". ")}. Swap those to place fewer orders.
      </p>}

      <ul className="piece-list">
        {pieces.map((view) => <PieceRow key={view.piece.id} view={view} index={selectedIndex(view)} onChoose={(i) => choose(view, i)} />)}
      </ul>

      <div className="costume-actions"><SaveLook slug={costume.costume.slug} name={costume.costume.name} showLabel /></div>

      <AssistantPanel costume={costume} onChoose={(pieceId, productId) => {
        const view = pieces.find(({ piece }) => piece.id === pieceId);
        const index = view?.options.findIndex(({ product }) => product.id === productId) ?? -1;
        if (index >= 0) setChosen((current) => ({ ...current, [pieceId]: index }));
      }} />
    </div>
  </div>;
}

function joinList(items: string[]) {
  const lower = items.map((item) => item.toLowerCase());
  return lower.length < 3 ? lower.join(" and ") : `${lower.slice(0, -1).join(", ")} and ${lower[lower.length - 1]}`;
}

function PieceRow({ view, index, onChoose }: { view: PieceView; index: number; onChoose: (index: number) => void }) {
  const cart = useCart();
  const [swapOpen, setSwapOpen] = useState(false);
  const { piece, options } = view;
  const option = options[index] ?? options[0];

  const header = <div className="piece-head">
    <h2 className="piece-name">{piece.name}</h2>
    {!piece.required && <span className="pill">Optional</span>}
  </div>;

  if (!option) {
    return <li className="piece">{header}<p className="sourcing-note">No available pick. Ask the assistant for help.</p></li>;
  }

  const inCart = cart.ready && cart.items.some((line) => line.pieceId === piece.id && line.productId === option.product.id);
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
      <button type="button" className="btn btn-small" disabled={!cart.ready || inCart || option.product.availability === "out_of_stock"}
        onClick={() => cart.add(toCartItem(piece, option))}>
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
