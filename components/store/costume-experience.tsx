"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, ShoppingBag, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import "./costume-experience.css";
import { AssistantPanel } from "@/components/assistant/panel";
import { formatPrice, useCart } from "@/lib/cart/context";
import { compatibleSize, toCartItem } from "@/lib/cart/item";
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
import { modelImage, useCostumeModel } from "@/lib/model-selection";
import { WardrobeRail } from "./wardrobe-rail";
import { CostumePieceInspector } from "./costume-piece-inspector";

export function CostumeExperience({ costume }: { costume: CostumeView }) {
  const { model } = useCostumeModel();
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
  const [draftSizes, setDraftSizes] = useState<Record<string, string | null>>({});
  const [inspectedPieceId, setInspectedPieceId] = useState<string>();
  const inspectionTrigger = useRef<HTMLButtonElement | null>(null);
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

  function sizeFor(view: PieceView, option: ProductOption): string | null {
    const item = toCartItem(view.piece, option);
    const current = ownsCart ? cart.items.find((line) => line.pieceId === view.piece.id) : undefined;
    // An explicit cart size, including an empty one, wins over an older draft.
    if (current?.productId === option.product.id) return compatibleSize(item, current.size);
    if (Object.hasOwn(draftSizes, option.product.id)) return compatibleSize(item, draftSizes[option.product.id]);
    return compatibleSize(item, current?.size);
  }

  function changeSize(view: PieceView, option: ProductOption, next: string) {
    const size = compatibleSize(toCartItem(view.piece, option), next);
    setDraftSizes((current) => ({ ...current, [option.product.id]: size }));
    if (ownsCart && cart.items.some((line) => line.pieceId === view.piece.id && line.productId === option.product.id)) cart.setSize(view.piece.id, size);
  }

  function rememberCartSize(view: PieceView) {
    const current = ownsCart ? cart.items.find((line) => line.pieceId === view.piece.id) : undefined;
    if (current) setDraftSizes((sizes) => ({ ...sizes, [current.productId]: current.size }));
  }

  function hasExplicitSize(view: PieceView, option: ProductOption): boolean {
    return Object.hasOwn(draftSizes, option.product.id)
      || ownsCart && cart.items.some((line) => line.pieceId === view.piece.id && line.productId === option.product.id);
  }

  function addPiece(view: PieceView, option: ProductOption) {
    const item = toCartItem(view.piece, option, sizeFor(view, option));
    cart.add(item, costumeSlug);
    // Preserve explicit clears while letting untouched products use saved preferences.
    if (hasExplicitSize(view, option)) cart.setSize(item.pieceId, item.size);
  }

  const picked = new Map<string, ProductOption | undefined>(
    pieces.map((view) => [view.piece.id, view.options[selectedIndex(view)] ?? view.options[0]]),
  );

  const needed = pieces.filter(({ piece }) => !uses[piece.id] || uses[piece.id] === "buy");
  const inspectedPiece = needed.find(({ piece }) => piece.id === inspectedPieceId);
  const inspectedOption = inspectedPiece && picked.get(inspectedPiece.piece.id);
  const flatlayItems = needed.flatMap((view) => {
    const option = picked.get(view.piece.id);
    if (!option) return [];
    return [{ key: view.piece.id, slideKey: `piece:${view.piece.id}`, name: view.piece.name, src: option.product.cutout ?? shot(option.product), alt: option.product.title, scale: option.product.cutout ? flatlayScale(view.piece) : 1, photo: !option.product.cutout }];
  });

  const slides: Slide[] = [
    { kind: "image", key: "complete-look", src: modelImage(costumeSlug, model), alt: `${costume.costume.name} worn by our ${model} model`, caption: `${costume.costume.name} · the complete look`, local: true, editorial: true },
    ...needed.flatMap((view) => {
      const option = picked.get(view.piece.id);
      return option ? [{ kind: "image" as const, key: `piece:${view.piece.id}`, src: shot(option.product), alt: option.product.title, caption: `${view.piece.name} · ${option.merchant.name}` }] : [];
    }),
    ...(flatlayItems.length > 0
      ? [{ kind: "flatlay" as const, key: "flat-lay", items: flatlayItems, caption: `${flatlayItems.length} selected pieces · select one for a closer look` }]
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
    rememberCartSize(view);
    // A piece already in the cart follows the swap.
    if (ownsCart && cart.items.some((line) => line.pieceId === view.piece.id)) addPiece(view, view.options[index]);
  }

  function addAll() {
    const items = pickedOptions.map(({ view, option }) => toCartItem(view.piece, option, sizeFor(view, option)));
    cart.addMany(items, costumeSlug);
    pickedOptions.forEach(({ view, option }, index) => {
      if (hasExplicitSize(view, option)) cart.setSize(items[index].pieceId, items[index].size);
    });
    cart.setOpen(true);
  }

  function applyMirror(outfit: MirrorOutfit) {
    const nextChosen: Record<string, number> = {};
    for (const view of pieces) {
      const index = view.options.findIndex(({ product }) => product.id === outfit.selection[view.piece.id]);
      if (index >= 0) nextChosen[view.piece.id] = index;
      const current = ownsCart ? cart.items.find((item) => item.pieceId === view.piece.id) : undefined;
      if (current) {
        rememberCartSize(view);
        if (outfit.uses[view.piece.id] !== "buy") cart.remove(view.piece.id);
        else if (index >= 0) addPiece(view, view.options[index]);
      }
    }
    setChosen(nextChosen);
    setUses(outfit.uses);
    setMirrorBudget(outfit.budget);
  }

  return <div className="costume-layout costume-shop">
    <header className="costume-heading">
      <Link href="/" className="back-link"><ArrowLeft size={14} aria-hidden="true" />All costumes</Link>
      <div className="costume-heading-title">
        <h1 className="costume-title">{costume.costume.name}</h1>
        <SaveLook slug={costumeSlug} name={costume.costume.name} />
      </div>
      <p className="costume-description">{costume.costume.description}</p>
    </header>

    <Tabs defaultValue="look" className="costume-media">
      <TabsList aria-label="Costume preview">
        <TabsTrigger value="look">The look</TabsTrigger>
        <TabsTrigger value="try-on"><Sparkles size={15} aria-hidden="true" />Try it on</TabsTrigger>
      </TabsList>
      {/* Keep photos and gallery position in memory when switching tabs. */}
      <TabsContent value="look" forceMount><Carousel slides={slides} hotspots={{
        items: pickedOptions.map(({ view, option }) => ({ pieceId: view.piece.id, name: view.piece.name, priceCents: option.product.priceCents, merchantName: option.merchant.name })),
        selectedPieceId: inspectedPiece?.piece.id,
        onSelect: (pieceId, trigger) => {
          inspectionTrigger.current = trigger;
          setInspectedPieceId(pieceId);
          if (pieceId === inspectedPieceId) document.getElementById("costume-piece-inspection")?.focus();
        },
      }} /></TabsContent>
      <TabsContent value="try-on" forceMount>
        <VirtualTryOn costumeSlug={costumeSlug} pieces={pieces.map(({ piece }) => ({ id: piece.id, name: piece.name, category: piece.category }))} selection={pickedOptions.map(({ view, option }) => ({ pieceId: view.piece.id, productId: option.product.id }))} ownedPieceIds={pieces.filter(({ piece }) => uses[piece.id] === "owned").map(({ piece }) => piece.id)} skippedPieceIds={pieces.filter(({ piece }) => uses[piece.id] === "skip").map(({ piece }) => piece.id)} totalCents={total} />
        <div className="costume-live-option"><span>Prefer a live preview?</span><LiveMirror costume={costume} initialOutfit={{ selection: Object.fromEntries(pieces.flatMap((view) => { const option = picked.get(view.piece.id); return option ? [[view.piece.id, option.product.id]] : []; })), uses, locked: [], budget: mirrorBudget }} onApply={applyMirror} /></div>
      </TabsContent>
    </Tabs>

    <div className="costume-info">
      {inspectedPiece && inspectedOption && <CostumePieceInspector costumeSlug={costumeSlug} view={inspectedPiece} index={selectedIndex(inspectedPiece)} size={sizeFor(inspectedPiece, inspectedOption)} onSizeChange={(size) => changeSize(inspectedPiece, inspectedOption, size)} onAdd={() => addPiece(inspectedPiece, inspectedOption)} onChoose={(index) => choose(inspectedPiece, index)} onClose={() => {
        setInspectedPieceId(undefined);
        inspectionTrigger.current?.focus();
      }} />}
      {pickedOptions.length > 0
        ? <div className="costume-purchase" id="selected-outfit">
            <div className="costume-total"><span>{formatPrice(total)}<small>USD</small></span><p>{pickedOptions.length} pieces · {shopCount} {shopCount === 1 ? "shop" : "shops"}</p></div>
            <Button className="costume-add" disabled={!complete || !cart.ready} onClick={addAll}><ShoppingBag aria-hidden="true" />Add costume to cart<ArrowRight aria-hidden="true" /></Button>
            {cart.ready && cart.items.length > 0 && !ownsCart && <p className="meta">This costume replaces the outfit in your cart.</p>}
            {ownsCart && cart.notice && !cart.isOpen && <div className="notice" role="status"><p>{cart.notice}</p><button type="button" className="text-btn" onClick={cart.dismissNotice}>Dismiss</button></div>}
          </div>
        : <p className="sourcing-note">Nothing to buy.</p>}

      <div className="costume-pieces-heading"><h2>Complete the look</h2><span>Change any piece</span></div>
      <ul className="outfit-pieces">
        {needed.map((view) => {
          const option = picked.get(view.piece.id);
          return <PieceRow key={view.piece.id} costumeSlug={costumeSlug} view={view} index={selectedIndex(view)} onAdd={() => { if (option) addPiece(view, option); }} onChoose={(i) => choose(view, i)} />;
        })}
      </ul>

      <div className="costume-help">
        <div><Sparkles size={18} aria-hidden="true" /><div><h2>Make it yours</h2><p>Set a budget, find local shops, or use what you own.</p></div></div>
        <Button variant="outline" onClick={() => window.dispatchEvent(new Event("halloween:open-assistant"))}>Talk to your personal shopper<ArrowRight aria-hidden="true" /></Button>
      </div>
      <details className="costume-sourcing">
        <summary>Find a lower-price outfit<ChevronDown size={16} aria-hidden="true" /></summary>
        <p>Compare the lowest-priced available picks in our catalog.</p>
        <ShopForMe pieces={sourcingPieces} onComplete={(choices) => {
          for (const view of pieces) {
            const index = choices[view.piece.id];
            if (index !== undefined) choose(view, index);
          }
        }} />
      </details>

      <AssistantPanel costume={costume} onChoose={(pieceId, productId) => {
        setUses((current) => ({ ...current, [pieceId]: "buy" }));
        const view = pieces.find(({ piece }) => piece.id === pieceId);
        const index = view?.options.findIndex(({ product }) => product.id === productId) ?? -1;
        if (index >= 0) setChosen((current) => ({ ...current, [pieceId]: index }));
      }} />
    </div>
  </div>;
}

function PieceRow({ costumeSlug, view, index, onAdd, onChoose }: { costumeSlug: string; view: PieceView; index: number; onAdd: () => void; onChoose: (index: number) => void }) {
  const cart = useCart();
  const [open, setOpen] = useState(false);
  const { piece, options } = view;
  const option = options[index] ?? options[0];
  if (!option) return <li className="outfit-piece"><p>{piece.name}</p><p className="meta">No available pick. Ask the assistant for help.</p></li>;
  const inCart = cart.ready && cart.costumeSlug === costumeSlug && cart.items.some((line) => line.pieceId === piece.id && line.productId === option.product.id);

  return <li className="outfit-piece">
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="outfit-piece-trigger" aria-label={`Change ${piece.name}`}>
          <span className="outfit-piece-image"><ProductImage src={shot(option.product)} alt="" /></span>
          <span className="outfit-piece-copy"><span className="outfit-piece-name">{piece.name}</span><span className="outfit-piece-product">{option.product.title}</span><span className="outfit-piece-merchant">{option.merchant.name}{option.pick.isLocal ? " · Local" : ""}{option.product.availability === "out_of_stock" ? " · Sold out" : ""}</span></span>
          <span className="outfit-piece-side"><span>{formatPrice(option.product.priceCents)}</span><span className="outfit-piece-change">Change<ChevronRight size={14} aria-hidden="true" /></span></span>
        </button>
      </DialogTrigger>
      <DialogContent className="piece-dialog wardrobe-rail-dialog">
        <div className="piece-dialog-heading"><DialogTitle>{piece.name}</DialogTitle><DialogDescription>Choose the piece that suits your style and budget.</DialogDescription></div>
        <WardrobeRail view={view} selectedId={option.product.id} onChoose={onChoose} />
        <details className="piece-reason"><summary>Why this pick?</summary><p>{option.pick.reason}</p></details>
        <a className="piece-merchant-link" href={option.product.url} target="_blank" rel="noopener noreferrer">View at {option.merchant.name}<ArrowRight size={14} aria-hidden="true" /></a>
        <div className="piece-dialog-footer">
          <Button variant="outline" disabled={!cart.ready || inCart || option.product.availability === "out_of_stock"} onClick={onAdd}>{inCart ? <><Check aria-hidden="true" />In cart</> : "Add this piece"}</Button>
          <DialogClose asChild><Button>Done</Button></DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  </li>;
}
