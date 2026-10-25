"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, ShoppingBag, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import "./costume-experience.css";
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
import { PhotoVoiceStylist } from "./photo-voice-stylist";
import { PhoneCameraProvider } from "./phone-camera";
import { LiveMirror } from "./live-mirror";
import type { MirrorOutfit } from "@/lib/live-mirror/types";
import { modelImage, useCostumeModel } from "@/lib/model-selection";

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
    { kind: "image", key: "complete-look", src: modelImage(costumeSlug, model), alt: `${costume.costume.name} worn by our ${model} model`, caption: `${costume.costume.name} · the complete look`, local: true, editorial: true },
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
      <TabsContent value="look" forceMount><Carousel slides={slides} /><p className="costume-image-note">Style inspiration. Preview may differ from the selected pieces.</p></TabsContent>
      <TabsContent value="try-on" forceMount><PhoneCameraProvider>
        <VirtualTryOn costumeSlug={costumeSlug} pieces={pieces.map(({ piece }) => ({ id: piece.id, name: piece.name, category: piece.category }))} selection={pickedOptions.map(({ view, option }) => ({ pieceId: view.piece.id, productId: option.product.id }))} ownedPieceIds={pieces.filter(({ piece }) => uses[piece.id] === "owned").map(({ piece }) => piece.id)} skippedPieceIds={pieces.filter(({ piece }) => uses[piece.id] === "skip").map(({ piece }) => piece.id)} totalCents={total} />
        <PhotoVoiceStylist costume={costume} outfit={{ selection: Object.fromEntries(pieces.flatMap((view) => { const option = picked.get(view.piece.id); return option ? [[view.piece.id, option.product.id]] : []; })), uses, locked: [], budget: mirrorBudget }} onApply={applyMirror} />
        <div className="costume-live-option"><span>Prefer a live preview?</span><LiveMirror costume={costume} initialOutfit={{ selection: Object.fromEntries(pieces.flatMap((view) => { const option = picked.get(view.piece.id); return option ? [[view.piece.id, option.product.id]] : []; })), uses, locked: [], budget: mirrorBudget }} onApply={applyMirror} /></div>
      </PhoneCameraProvider></TabsContent>
    </Tabs>

    <div className="costume-info">
      {pickedOptions.length > 0
        ? <div className="costume-purchase" id="selected-outfit">
            <div className="costume-total"><span>{formatPrice(total)}<small>USD</small></span><p>{pickedOptions.length} pieces · {shopCount} {shopCount === 1 ? "shop" : "shops"}</p></div>
            <Button className="costume-add" disabled={!complete || !cart.ready} onClick={addAll}><ShoppingBag aria-hidden="true" />Add costume to cart<ArrowRight aria-hidden="true" /></Button>
            <p className="costume-purchase-note">Merchant prices only. No added fees.</p>
            {cart.ready && cart.items.length > 0 && !ownsCart && <p className="meta">This costume replaces the outfit in your cart.</p>}
            {ownsCart && cart.notice && !cart.isOpen && <div className="notice" role="status"><p>{cart.notice}</p><button type="button" className="text-btn" onClick={cart.dismissNotice}>Dismiss</button></div>}
          </div>
        : <p className="sourcing-note">Nothing to buy.</p>}

      <div className="costume-pieces-heading"><h2>Complete the look</h2><span>Change any piece</span></div>
      <ul className="outfit-pieces">
        {needed.map((view) => <PieceRow key={view.piece.id} costumeSlug={costumeSlug} view={view} index={selectedIndex(view)} onChoose={(i) => choose(view, i)} />)}
      </ul>

      <div className="costume-help">
        <div><Sparkles size={18} aria-hidden="true" /><div><h2>Make it yours</h2><p>Set a budget, find local shops, or use what you own.</p></div></div>
        <Button variant="outline" onClick={() => window.dispatchEvent(new Event("halloween:open-assistant"))}>Ask the assistant<ArrowRight aria-hidden="true" /></Button>
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

function PieceRow({ costumeSlug, view, index, onChoose }: { costumeSlug: string; view: PieceView; index: number; onChoose: (index: number) => void }) {
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
      <DialogContent className="piece-dialog">
        <div className="piece-dialog-heading"><DialogTitle>{piece.name}</DialogTitle><DialogDescription>Choose the piece that suits your style and budget.</DialogDescription></div>
        <div className="piece-options" role="group" aria-label={`Options for ${piece.name}`}>
          {[...options].sort((a, b) => a.product.priceCents - b.product.priceCents).map((candidate) => {
            const selected = candidate.product.id === option.product.id;
            return <button type="button" className="piece-option" key={candidate.product.id} aria-pressed={selected} disabled={candidate.product.availability === "out_of_stock"} onClick={() => onChoose(options.indexOf(candidate))}>
              <span className="piece-option-image"><ProductImage src={shot(candidate.product)} alt="" /></span>
              <span className="piece-option-copy"><span className="piece-option-title">{candidate.product.title}</span><span className="piece-option-merchant">{candidate.merchant.name}{candidate.pick.isLocal ? " · Local" : ""}</span><span className="piece-option-price">{formatPrice(candidate.product.priceCents)}{candidate.product.availability === "out_of_stock" ? " · Sold out" : candidate.product.availability === "unknown" ? " · Check stock" : ""}</span></span>
              <span className="piece-option-check" aria-hidden="true">{selected && <Check size={14} />}</span>
            </button>;
          })}
        </div>
        <details className="piece-reason"><summary>Why this pick?</summary><p>{option.pick.reason}</p></details>
        <a className="piece-merchant-link" href={option.product.url} target="_blank" rel="noopener noreferrer">View at {option.merchant.name}<ArrowRight size={14} aria-hidden="true" /></a>
        <div className="piece-dialog-footer">
          <Button variant="outline" disabled={!cart.ready || inCart || option.product.availability === "out_of_stock"} onClick={() => cart.add(toCartItem(piece, option), costumeSlug)}>{inCart ? <><Check aria-hidden="true" />In cart</> : "Add this piece"}</Button>
          <DialogClose asChild><Button>Done</Button></DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  </li>;
}
