"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AssistantPanel } from "@/components/assistant/panel";
import { formatPrice, useCart } from "@/lib/cart/context";
import { toCartItem } from "@/lib/cart/item";
import type { CostumeView, PieceView, ProductOption } from "@/lib/types";
import { SaveLook } from "@/components/saved-looks";
import { Carousel, type Slide } from "./carousel";
import { ProductImage, shot } from "./product-image";
import { ShopForMe } from "./shop-for-me";
import { flatlayScale } from "@/lib/products/flatlay";
import { VirtualTryOn } from "./virtual-try-on";
import { readLook } from "@/lib/share-card";
import { LiveMirror } from "./live-mirror";
import type { MirrorOutfit } from "@/lib/live-mirror/types";

export function CostumeExperience({ costume, editorial }: { costume: CostumeView; editorial?: { image: string; alt: string } }) {
  const cart = useCart();
  const costumeSlug = costume.costume.slug;
  const ownsCart = cart.costumeSlug === costumeSlug;
  const pieces = useMemo(() => [...costume.pieces].sort((a, b) => a.piece.order - b.piece.order), [costume.pieces]);
  const { ready, reconcile } = cart;
  useEffect(() => {
    if (ready) reconcile(pieces.flatMap(({ piece, options }) => options.map((option) => toCartItem(piece, option))), costumeSlug);
  }, [ready, reconcile, pieces, costumeSlug]);
  // Chosen option index per piece; 0 is the default pick.
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [uses, setUses] = useState<MirrorOutfit["uses"]>({});
  const [mirrorBudget, setMirrorBudget] = useState("");
  useEffect(() => {
    // A shared look link opens with the sender's exact pieces picked.
    const look = readLook(window.location.search);
    if (look.length === 0) return;
    const next: Record<string, number> = {};
    for (const view of pieces) {
      const index = view.options.findIndex(({ product }) => look.includes(product.id) && product.availability !== "out_of_stock");
      if (index >= 0) next[view.piece.id] = index;
    }
    // The URL is only readable on the client.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChosen(next);
    const params = new URLSearchParams(window.location.search);
    const owned = (params.get("owned") ?? "").split(",");
    const skipped = (params.get("skipped") ?? "").split(",");
    // Restore only catalog-known choices; required pieces cannot be omitted.
    setUses(Object.fromEntries(pieces.map(({ piece }) => [piece.id, owned.includes(piece.id) ? "owned" : !piece.required && skipped.includes(piece.id) ? "skip" : "buy"])));
  }, [pieces]);
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

  const needed = pieces.filter(({ piece }) => !uses[piece.id] || uses[piece.id] === "buy");
  const flatlayItems = needed.flatMap((view) => {
    const option = picked.get(view.piece.id);
    return option?.product.cutout ? [{ key: view.piece.id, src: option.product.cutout, alt: `${view.piece.name}: ${option.product.title}`, scale: flatlayScale(view.piece) }] : [];
  });

  const slides: Slide[] = [
    { kind: "image", key: "complete-look", src: editorial?.image ?? costume.costume.image, alt: editorial?.alt ?? costume.costume.alt, caption: `${costume.costume.name} · the complete look`, local: (editorial?.image ?? costume.costume.image).startsWith("/"), editorial: true },
    ...needed.flatMap((view) => {
      const option = picked.get(view.piece.id);
      return option ? [{ kind: "image" as const, key: `${view.piece.id}:${option.product.id}`, src: shot(option.product), alt: option.product.title, caption: `${view.piece.name} · ${option.merchant.name}` }] : [];
    }),
    ...(flatlayItems.length > 0 && flatlayItems.length === needed.length
      ? [{ kind: "flatlay" as const, key: "flat-lay", items: flatlayItems, caption: `${flatlayItems.length} selected pieces` }]
      : []),
  ];

  const pickedOptions = pieces.flatMap((view) => {
    if (uses[view.piece.id] === "owned" || uses[view.piece.id] === "skip") return [];
    const option = picked.get(view.piece.id);
    return option ? [{ view, option }] : [];
  });
  const total = pickedOptions.reduce((sum, { option }) => sum + option.product.priceCents, 0);
  const shopCount = new Set(pickedOptions.map(({ option }) => option.merchant.id)).size;
  const complete = pickedOptions.length > 0 && pickedOptions.length === needed.length && pickedOptions.every(({ option }) => option.product.availability !== "out_of_stock");

  function choose(view: PieceView, index: number) {
    if (!view.options[index] || view.options[index].product.availability === "out_of_stock") return;
    setChosen((current) => ({ ...current, [view.piece.id]: index }));
    // A piece already in the cart follows the swap.
    if (ownsCart && cart.items.some((line) => line.pieceId === view.piece.id)) cart.add(toCartItem(view.piece, view.options[index], cart.items.find((line) => line.pieceId === view.piece.id)?.size ?? null), costumeSlug);
  }

  function addAll() {
    cart.addMany(pickedOptions.map(({ view, option }) => toCartItem(view.piece, option, cart.items.find((line) => line.pieceId === view.piece.id)?.size ?? null)), costumeSlug);
    cart.setOpen(true);
  }

  function applyMirror(outfit: MirrorOutfit) {
    const nextChosen: Record<string, number> = {};
    for (const view of pieces) {
      const index = view.options.findIndex(({ product }) => product.id === outfit.selection[view.piece.id]);
      if (index >= 0) nextChosen[view.piece.id] = index;
      const current = ownsCart ? cart.items.find((item) => item.pieceId === view.piece.id) : undefined;
      if (current) {
        if (outfit.uses[view.piece.id] !== "buy") cart.remove(view.piece.id);
        else if (index >= 0) cart.add(toCartItem(view.piece, view.options[index], current.size), costumeSlug);
      }
    }
    setChosen(nextChosen);
    setUses(outfit.uses);
    setMirrorBudget(outfit.budget);
  }

  return <div className="costume-layout costume-layout-simple">
    <div className="costume-media"><Carousel slides={slides} /><LiveMirror costume={costume} initialOutfit={{ selection: Object.fromEntries(pieces.flatMap((view) => { const option = picked.get(view.piece.id); return option ? [[view.piece.id, option.product.id]] : []; })), uses, locked: [], budget: mirrorBudget }} onApply={applyMirror} /><VirtualTryOn costumeSlug={costumeSlug} selection={pickedOptions.map(({ view, option }) => ({ pieceId: view.piece.id, productId: option.product.id }))} ownedPieceIds={pieces.filter(({ piece }) => uses[piece.id] === "owned").map(({ piece }) => piece.id)} skippedPieceIds={pieces.filter(({ piece }) => uses[piece.id] === "skip").map(({ piece }) => piece.id)} totalCents={total} /></div>
    <div className="costume-info">
      <Link href="/" className="back-link">All costumes</Link>
      <h1 className="costume-title">{costume.costume.name}</h1>
      <p className="costume-description">{costume.costume.description}</p>

      <ShopForMe pieces={sourcingPieces} onComplete={(choices) => {
        for (const view of pieces) {
          const index = choices[view.piece.id];
          if (index !== undefined) choose(view, index);
        }
      }} />

      {pickedOptions.length > 0
        ? <div className="whole-costume" id="selected-outfit">
            <button type="button" className="btn btn-block" disabled={!complete || !cart.ready} onClick={addAll}>Add whole costume · {formatPrice(total)}</button>
            <p className="meta">{pickedOptions.length} pieces · {shopCount} {shopCount === 1 ? "shop" : "shops"} · Merchant prices only. No added charges.</p>
            <button type="button" className="text-btn assistant-size-link" onClick={() => window.dispatchEvent(new Event("halloween:open-assistant"))}>Set your budget & sizes →</button>
            {cart.ready && cart.items.length > 0 && !ownsCart && <p className="meta">Replaces the other outfit in your cart.</p>}
            {ownsCart && cart.notice && !cart.isOpen && <div className="notice" role="status"><p>{cart.notice}</p><button type="button" className="text-btn" onClick={cart.dismissNotice}>Dismiss</button></div>}
          </div>
        : <p className="sourcing-note">Nothing to buy.</p>}

      <ul className="piece-list">
        {needed.map((view) => <PieceRow key={view.piece.id} costumeSlug={costumeSlug} view={view} index={selectedIndex(view)} onChoose={(i) => choose(view, i)} />)}
      </ul>

      <div className="costume-actions"><SaveLook slug={costume.costume.slug} name={costume.costume.name} showLabel /></div>

      <AssistantPanel costume={costume} onChoose={(pieceId, productId) => {
        setUses((current) => ({ ...current, [pieceId]: "buy" }));
        const view = pieces.find(({ piece }) => piece.id === pieceId);
        const index = view?.options.findIndex(({ product }) => product.id === productId) ?? -1;
        if (index >= 0) setChosen((current) => ({ ...current, [pieceId]: index }));
      }} />
    </div>
  </div>;
}

function PieceRow({ costumeSlug, view, index, onChoose }: { costumeSlug: string; view: PieceView; index: number; onChoose: (index: number) => void }) {
  const cart = useCart();
  const [swapOpen, setSwapOpen] = useState(false);
  const { piece, options } = view;
  const option = options[index] ?? options[0];

  const header = <div className="piece-head">
    <h2 className="piece-name">{piece.name}</h2>
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
        <ProductImage src={shot(option.product)} alt="" />
      </a>
      <div className="piece-body">
        <p className="piece-title">{option.product.title}</p>
        <p className="piece-merchant">{option.merchant.name}{hood ? ` · ${hood.name}` : ""}</p>
        <div className="piece-tags">
          <span className="pill">{option.pick.priceTier}</span>
          {option.product.availability === "unknown" && <span className="pill">Check stock</span>}
          {option.pick.isLocal && <span className="pill pill-local">Support local</span>}
          {option.product.availability === "out_of_stock" && <span className="pill">Sold out</span>}
        </div>
      </div>
      <p className="piece-price">{formatPrice(option.product.priceCents)}</p>
    </div>

    <div className="piece-price-tiers" role="group" aria-label={`Price points for ${piece.name}`}>
      {[...options].sort((a, b) => a.product.priceCents - b.product.priceCents).map((candidate) => <button key={candidate.product.id} type="button" className={candidate.product.id === option.product.id ? "is-current" : ""} aria-pressed={candidate.product.id === option.product.id} disabled={candidate.product.availability === "out_of_stock"} onClick={() => onChoose(options.indexOf(candidate))}>
        <span>{candidate.pick.priceTier}</span><span>{formatPrice(candidate.product.priceCents)}</span>
      </button>)}
    </div>
    <div className="piece-actions">
      <button type="button" className="text-btn" disabled={!cart.ready || inCart || option.product.availability === "out_of_stock"}
        onClick={() => cart.add(toCartItem(piece, option), costumeSlug)}>
        {inCart ? "In cart" : "Add to cart"}
      </button>
      {options.length > 1 && <button type="button" className="text-btn" aria-expanded={swapOpen} aria-label={`Change ${piece.name}`} onClick={() => setSwapOpen((open) => !open)}>
        Change
      </button>}
      <details className="why">
        <summary>Why this pick</summary>
        <p>{option.pick.reason}</p>
      </details>
    </div>

    {swapOpen && <div className="swap" role="group" aria-label={`Choose ${piece.name}`}>
      {options.map((candidate, i) => <button type="button" aria-pressed={i === index} key={candidate.product.id} disabled={candidate.product.availability === "out_of_stock"}
        className={`swap-option ${i === index ? "is-current" : ""}`} onClick={() => onChoose(i)}>
        <span className="swap-thumb"><ProductImage src={shot(candidate.product)} alt="" /></span>
        <span className="swap-label">{candidate.pick.priceTier}</span>
        <span className="swap-title">{candidate.product.title}</span>
        <span className="swap-meta">{candidate.merchant.name} · {formatPrice(candidate.product.priceCents)}{candidate.pick.isLocal ? " · local" : ""}{candidate.product.availability === "out_of_stock" ? " · sold out" : ""}</span>
      </button>)}
    </div>}
  </li>;
}
