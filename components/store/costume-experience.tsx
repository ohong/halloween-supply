"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Camera, Check, ChevronDown, ChevronRight, ShoppingBag, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import "./costume-experience.css";
import { AssistantPanel } from "@/components/assistant/panel";
import { formatPrice, useCart } from "@/lib/cart/context";
import { compatibleSize, toCartItem } from "@/lib/cart/item";
import type { CostumeView, PieceView, ProductOption } from "@/lib/types";
import { SaveLook, useSavedLooks } from "@/components/saved-looks";
import { Carousel, type Slide } from "./carousel";
import { ProductImage, shot } from "./product-image";
import { ShopForMe } from "./shop-for-me";
import { flatlayScale } from "@/lib/products/flatlay";
import { VirtualTryOn } from "./virtual-try-on";
import { lookUrl } from "@/lib/share-card";
import { readLookSelection, readLocalLook, resolveLookSelection, saveLocalLook, type LookSelection } from "@/lib/look-selection";
import type { KitView } from "@/lib/kits";
import { trackEvent } from "@/lib/telemetry/client";
import { PhotoVoiceStylist } from "./photo-voice-stylist";
import { PhoneCameraProvider } from "./phone-camera";
import { LiveMirror } from "./live-mirror";
import { mixSchema } from "@/lib/live-mirror/mix-schema";
import { z } from "zod";
import type { MirrorOutfit } from "@/lib/live-mirror/types";
import { modelImage, useCostumeModel } from "@/lib/model-selection";
import { WardrobeRail } from "./wardrobe-rail";
import { CostumePieceInspector } from "./costume-piece-inspector";

function kitTooLateProducts(kit: KitView | null | undefined, eventDate: string) {
  if (!kit || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return [];
  return [...new Set(kit.readiness.evidence.flatMap(evidence => evidence.earliestArrivalDate && evidence.earliestArrivalDate > eventDate
    ? evidence.productId ? [evidence.productId] : kit.buy.map(row => row.product.id) : []))];
}

export function CostumeExperience({ costume: initialCostume, kit, voiceProvider }: { costume: CostumeView; kit?: KitView | null; voiceProvider?: "openai" | "gemini" }) {
  const [mixedCostume, setMixedCostume] = useState<CostumeView | null>(null);
  const [mixes, setMixes] = useState<MirrorOutfit["mixes"]>();
  const costume = mixedCostume ?? initialCostume;
  const { model, setModel } = useCostumeModel();
  const restoreModel = useRef(setModel);
  const { saved } = useSavedLooks();
  const cart = useCart();
  const costumeSlug = costume.costume.slug;
  const ownsCart = cart.costumeSlug === costumeSlug;
  useEffect(() => { trackEvent("view", { source: "look", slug: costumeSlug, mode: "catalog" }); }, [costumeSlug]);
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
  const [previewEdits, setPreviewEdits] = useState<LookSelection["previewEdits"]>();
  const [restoreIssues, setRestoreIssues] = useState<string[]>([]);
  const [shareNote, setShareNote] = useState("");
  const [recoveryPieceId, setRecoveryPieceId] = useState<string>();
  const [kitApplied, setKitApplied] = useState(false);
  const [eventDate, setEventDate] = useState("");
  const tooLateProductIds = kitTooLateProducts(kit, eventDate);
  const [restoreState, setRestoreState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(window.location.search);
    const requestedDate = params.get("eventDate") ?? "";
    void (async () => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) setEventDate(requestedDate);
      const shared = readLookSelection(window.location.search, initialCostume.costume.slug);
      if (shared.status === "invalid") throw new Error(shared.error);
      const local = shared.status === "none" && !params.has("kit") ? readLocalLook(initialCostume.costume.slug) : null;
      const restored = shared.status === "valid" ? shared.snapshot ?? shared : local?.snapshot;
      if (restored) {
        let view = initialCostume;
        if (restored.mixes?.length) {
          const refs = z.array(mixSchema).max(12).parse(restored.mixes);
          const response = await fetch(`/api/live-mirror/catalog?slug=${encodeURIComponent(initialCostume.costume.slug)}&mix=${encodeURIComponent(JSON.stringify(refs))}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
          if (!response.ok) throw new Error("The mixed pieces could not be restored.");
          view = await response.json() as CostumeView;
        }
        if (controller.signal.aborted) return;
        const resolved = resolveLookSelection(view, { ...restored, selection: "selection" in restored ? restored.selection : [] });
        setMixedCostume(restored.mixes?.length ? view : null);
        setMixes(restored.mixes);
        setChosen(resolved.chosen);
        setUses(resolved.uses);
        setPreviewEdits(restored.previewEdits);
        if (restored.model) restoreModel.current(restored.model);
        if (local) setDraftSizes(local.sizes);
        if (resolved.issues.length) { setRestoreIssues(resolved.issues); setRestoreState("error"); }
      } else if (kit && params.get("kit") === kit.slug) {
        if (!kit.eligible || kitTooLateProducts(kit, requestedDate).length > 0 || kit.buy.some(row => row.quantity !== 1)) throw new Error("This kit needs a replacement before it can be applied.");
        const next: Record<string, number> = {};
        for (const row of kit.buy) {
          const index = initialCostume.pieces.find(view => view.piece.id === row.piece.id)?.options.findIndex(option => option.product.id === row.product.id) ?? -1;
          if (index < 0) throw new Error("One kit product is no longer available. Choose another version.");
          next[row.piece.id] = index;
        }
        setChosen(next);
        setUses(Object.fromEntries([...kit.buy.map(row => [row.piece.id, "buy"]), ...kit.owned.map(row => [row.piece.id, "owned"]), ...kit.skipped.map(row => [row.piece.id, "skip"])]) as MirrorOutfit["uses"]);
        setKitApplied(true);
        trackEvent("kit", { source: "look", slug: initialCostume.costume.slug, mode: "catalog", stage: "state_applied" });
      }
      const requestedPiece = params.get("piece");
      if (requestedPiece && initialCostume.pieces.some(row => row.piece.id === requestedPiece)) setRecoveryPieceId(requestedPiece);
    })().then(() => { if (!controller.signal.aborted) setRestoreState(state => state === "error" ? state : "ready"); })
      .catch((error) => { if (!controller.signal.aborted) { setRestoreIssues([error instanceof Error ? error.message : "This look could not be restored."]); setRestoreState("error"); } });
    return () => controller.abort();
  }, [initialCostume, kit]);
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
    if (restoreState !== "ready" || !cart.ready) return;
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
  const lateSelected = pickedOptions.some(({ option }) => tooLateProductIds.includes(option.product.id));
  const complete = restoreState === "ready" && !lateSelected && pickedOptions.length > 0 && pickedOptions.length === needed.length && pickedOptions.every(({ option }) => option.product.availability !== "out_of_stock");
  const snapshot: LookSelection = {
    version: 1, costumeSlug, model,
    selection: pickedOptions.map(({ view, option }) => ({ pieceId: view.piece.id, productId: option.product.id })),
    ownedPieceIds: pieces.filter(({ piece }) => uses[piece.id] === "owned").map(({ piece }) => piece.id),
    skippedPieceIds: pieces.filter(({ piece }) => uses[piece.id] === "skip").map(({ piece }) => piece.id),
    mixes: mixes ?? [], ...(previewEdits ? { previewEdits } : {}),
  };
  const snapshotKey = JSON.stringify(snapshot);
  const privateSizes = { ...draftSizes, ...(ownsCart ? Object.fromEntries(cart.items.map(item => [item.productId, item.size])) : {}) };
  const sizesKey = JSON.stringify(privateSizes);
  const isSaved = saved.includes(costumeSlug);
  useEffect(() => {
    if (restoreState === "ready" && isSaved) saveLocalLook(JSON.parse(snapshotKey), JSON.parse(sizesKey));
  }, [snapshotKey, sizesKey, isSaved, restoreState]);

  async function copyLookLink() {
    if (restoreState !== "ready") return;
    const url = lookUrl(location.origin, costumeSlug, snapshot.selection.map(row => row.productId), mixes, snapshot);
    try { await navigator.clipboard.writeText(url); setShareNote("Look link copied. Sizes and photos stay private."); }
    catch { setShareNote("The link could not be copied. Try again in your browser."); }
  }

  function changeUse(view: PieceView, use: "buy" | "owned" | "skip") {
    if (use === "skip" && view.piece.required) return;
    setUses(current => ({ ...current, [view.piece.id]: use }));
    if (use !== "buy" && ownsCart) cart.remove(view.piece.id);
  }

  function applyKit() {
    if (restoreState !== "ready" || !kit?.eligible || tooLateProductIds.length > 0 || kit.buy.some(row => row.quantity !== 1)) return;
    const next: Record<string, number> = {};
    for (const row of kit.buy) {
      const index = initialCostume.pieces.find(view => view.piece.id === row.piece.id)?.options.findIndex(option => option.product.id === row.product.id) ?? -1;
      if (index < 0) { setShareNote("This kit needs a replacement. Choose a version below."); return; }
      next[row.piece.id] = index;
    }
    setMixedCostume(null); setMixes(undefined); setChosen(next); setPreviewEdits(undefined);
    setUses(Object.fromEntries([...kit.buy.map(row => [row.piece.id, "buy"]), ...kit.owned.map(row => [row.piece.id, "owned"]), ...kit.skipped.map(row => [row.piece.id, "skip"])]) as MirrorOutfit["uses"]);
    if (ownsCart) { setDraftSizes(current => ({ ...current, ...Object.fromEntries(cart.items.map(item => [item.productId, item.size])) })); cart.clear(); }
    setKitApplied(true);
    trackEvent("kit", { source: "look", slug: costumeSlug, mode: "catalog", stage: "state_applied" });
    setRestoreState("ready"); setRestoreIssues([]);
  }


  function choose(view: PieceView, index: number) {
    if (!view.options[index] || view.options[index].product.availability === "out_of_stock") return;
    setChosen((current) => ({ ...current, [view.piece.id]: index }));
    trackEvent("swap", { source: "look", slug: costumeSlug, mode: "catalog", stage: "state_applied" });
    rememberCartSize(view);
    // A piece already in the cart follows the swap.
    if (ownsCart && cart.items.some((line) => line.pieceId === view.piece.id)) addPiece(view, view.options[index]);
  }

  function addAll() {
    if (restoreState !== "ready" || !cart.ready || !complete) return;
    const items = pickedOptions.map(({ view, option }) => toCartItem(view.piece, option, sizeFor(view, option)));
    if (ownsCart) for (const line of cart.items) if (!items.some(item => item.pieceId === line.pieceId)) cart.remove(line.pieceId);
    cart.addMany(items, costumeSlug);
    trackEvent("cart_add", { source: "look", slug: costumeSlug, mode: "catalog", units: items.length });
    pickedOptions.forEach(({ view, option }, index) => {
      if (hasExplicitSize(view, option)) cart.setSize(items[index].pieceId, items[index].size);
    });
    cart.setOpen(true);
  }

  function applyMirror(outfit: MirrorOutfit, nextCostume = costume) {
    if (restoreState !== "ready") return;
    setMixedCostume(nextCostume);
    setMixes(outfit.mixes);
    const nextPieces = nextCostume.pieces;
    if (ownsCart) {
      for (const old of pieces) if (!nextPieces.some(row => row.piece.id === old.piece.id)) cart.remove(old.piece.id);
    }
    const nextChosen: Record<string, number> = {};
    for (const view of nextPieces) {
      const index = view.options.findIndex(({ product }) => product.id === outfit.selection[view.piece.id]);
      if (index >= 0) nextChosen[view.piece.id] = index;
      const replaced = outfit.mixes?.find(ref => ref.pieceId === view.piece.id)?.replacesPieceId;
      const restored = mixes?.find(ref => ref.replacesPieceId === view.piece.id)?.pieceId;
      const current = ownsCart ? cart.items.find(item => [view.piece.id, replaced, restored].includes(item.pieceId)) : undefined;
      if (current) {
        rememberCartSize(view);
        if (outfit.uses[view.piece.id] !== "buy") cart.remove(view.piece.id);
        else if (index >= 0) addPiece(view, view.options[index]);
      }
    }
    setChosen(nextChosen);
    setUses(outfit.uses);
    setMirrorBudget(outfit.budget);
    setPreviewEdits(outfit.appearance);
  }

  return <div className="costume-layout costume-shop">
    <header className="costume-heading">
      <Link href="/" className="back-link"><ArrowLeft size={14} aria-hidden="true" />All costumes</Link>
      <div className="costume-heading-title">
        <h1 className="costume-title">{costume.costume.name}</h1>
        <SaveLook slug={costumeSlug} name={costume.costume.name} snapshot={snapshot} sizes={privateSizes} disabled={restoreState !== "ready"} />
      </div>
      <p className="costume-description">{costume.costume.description}</p>
      <div className="look-share"><button type="button" className="text-btn" disabled={restoreState !== "ready"} onClick={copyLookLink}>Copy look link</button>{shareNote && <p role="status">{shareNote}</p>}</div>
      {restoreState === "error" && <div className="notice" role="alert"><p>This look needs a repair. {restoreIssues.join(" ")}</p><button type="button" className="text-btn" onClick={() => { setRestoreState("ready"); setRestoreIssues([]); }}>Use available picks</button></div>}
      {previewEdits && Object.keys(previewEdits).length > 0 && <p className="meta">Visual edits are saved as preview notes. Merchant products remain the choices listed below.</p>}
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
      <TabsContent value="try-on" forceMount>{restoreState !== "ready" ? <p role="status">{restoreState === "loading" ? "Restoring your look…" : "Repair this saved look before creating a preview."}</p> : <PhoneCameraProvider>
        <VirtualTryOn previewEdits={previewEdits} mixes={mixes} costumeSlug={costumeSlug} pieces={pieces.map(({ piece }) => ({ id: piece.id, name: piece.name, category: piece.category }))} selection={snapshot.selection} ownedPieceIds={pieces.filter(({ piece }) => uses[piece.id] === "owned").map(({ piece }) => piece.id)} skippedPieceIds={pieces.filter(({ piece }) => uses[piece.id] === "skip").map(({ piece }) => piece.id)} totalCents={total} />
        <section className="try-on-more" aria-labelledby="try-on-more-title">
          <h3 id="try-on-more-title">More ways to try it on</h3>
          <div className="try-on-option">
            <span className="try-on-option-icon" aria-hidden="true"><Camera size={18} /></span>
            <div><p>Live mirror</p><p className="try-on-option-hint">See the look on your camera in real time.</p></div>
            <LiveMirror costume={costume} voiceProvider={voiceProvider} initialOutfit={{ appearance: previewEdits, mixes, selection: Object.fromEntries(pieces.flatMap((view) => { const option = picked.get(view.piece.id); return option ? [[view.piece.id, option.product.id]] : []; })), uses, locked: [], budget: mirrorBudget }} onApply={applyMirror} />
          </div>
          <PhotoVoiceStylist costume={costume} outfit={{ appearance: previewEdits, mixes, selection: Object.fromEntries(pieces.flatMap((view) => { const option = picked.get(view.piece.id); return option ? [[view.piece.id, option.product.id]] : []; })), uses, locked: [], budget: mirrorBudget }} onApply={applyMirror} />
        </section>
      </PhoneCameraProvider>}</TabsContent>
    </Tabs>

    <div className="costume-info">
      {inspectedPiece && inspectedOption && <CostumePieceInspector purchaseReady={restoreState === "ready"} costumeSlug={costumeSlug} view={inspectedPiece} index={selectedIndex(inspectedPiece)} size={sizeFor(inspectedPiece, inspectedOption)} onSizeChange={(size) => changeSize(inspectedPiece, inspectedOption, size)} onAdd={() => addPiece(inspectedPiece, inspectedOption)} onChoose={(index) => choose(inspectedPiece, index)} onClose={() => {
        setInspectedPieceId(undefined);
        inspectionTrigger.current?.focus();
      }} />}
      {kit && <section className="costume-kit" aria-labelledby="costume-kit-title">
        <div><h2 id="costume-kit-title">{kit.name}</h2><strong>{formatPrice(kit.purchaseSubtotalCents)} in new pieces</strong></div>
        <p>{kit.description}</p>
        <p><b>Already own:</b> {kit.ownedBasics.join("; ")}</p>
        <p><b>Assembly:</b> about {kit.assemblyMinutes} minutes. {kit.definition.assembly.steps.join(" ")}</p>
        {kit.supplies.length > 0 && <p><b>Extra supplies:</b> {kit.supplies.join(", ")}. Supplies are outside the subtotal.</p>}
        {kit.definition.assembly.tools.length > 0 && <p><b>Tools:</b> {kit.definition.assembly.tools.join(", ")}</p>}
        <label className="kit-event-date">Event date<input type="date" value={eventDate} onChange={event => setEventDate(event.target.value)} /></label>
        <p>{tooLateProductIds.length > 0 || kit.readiness.status === "known_too_late" ? "Known too late for this event." : kit.readiness.status === "pickup_option_found" ? `Pickup option found for ${kit.pickupItemCount} ${kit.pickupItemCount === 1 ? "item" : "items"}. Confirm each shop; other delivery is unconfirmed.` : "Delivery is unconfirmed. Check the shop before buying."}</p>
        {kit.readiness.notes.map(note => <p key={note}>{note}</p>)}
        <details><summary>Shipping and assembly research snapshot</summary><ul>{kit.readiness.evidence.map((evidence, i) => <li key={i}><a href={evidence.url} target="_blank" rel="noopener noreferrer">{evidence.note}</a> · checked {evidence.checkedAt.slice(0, 10)}</li>)}</ul></details>
        <Button variant="outline" disabled={restoreState !== "ready" || !kit.eligible || tooLateProductIds.length > 0 || kit.buy.some(row => row.quantity !== 1)} onClick={applyKit}>{kitApplied ? "Reapply this kit" : "Use this kit"}</Button>
      </section>}
      {pickedOptions.length > 0
        ? <div className="costume-purchase" id="selected-outfit">
            <div className="costume-total"><span>{formatPrice(total)}<small>USD</small></span><p>{pickedOptions.length} pieces · {shopCount} {shopCount === 1 ? "shop" : "shops"}</p></div>
            {lateSelected && <p className="meta" role="alert">A selected product is known to arrive after your event. Choose another version below.</p>}
            <Button className="costume-add" disabled={!complete || !cart.ready} onClick={addAll}><ShoppingBag aria-hidden="true" />Add costume to cart<ArrowRight aria-hidden="true" /></Button>
            {cart.ready && cart.items.length > 0 && !ownsCart && <p className="meta">This costume replaces the outfit in your cart.</p>}
            {ownsCart && cart.notice && !cart.isOpen && <div className="notice" role="status"><p>{cart.notice}</p><button type="button" className="text-btn" onClick={cart.dismissNotice}>Dismiss</button></div>}
          </div>
        : <p className="sourcing-note">Nothing to buy.</p>}

      <div className="costume-pieces-heading"><h2>Complete the look</h2><span>Change any piece</span></div>
      <ul className="outfit-pieces">
        {pieces.map((view) => {
          const option = picked.get(view.piece.id);
          return <PieceRow purchaseReady={restoreState === "ready"} key={view.piece.id} costumeSlug={costumeSlug} view={view} index={selectedIndex(view)} use={uses[view.piece.id] ?? "buy"} onUse={(use) => changeUse(view, use)} recoveryOpen={recoveryPieceId === view.piece.id} onRecoveryClose={() => setRecoveryPieceId(undefined)} onAdd={() => { if (option) addPiece(view, option); }} onChoose={(i) => choose(view, i)} />;
        })}
      </ul>

      <div className="costume-help">
        <div><Sparkles size={18} aria-hidden="true" /><div><h2>Make it yours</h2><p>Set a budget, find local shops, or use what you own.</p></div></div>
        <Button variant="outline" disabled={restoreState !== "ready"} onClick={() => window.dispatchEvent(new Event("halloween:open-assistant"))}>Talk to your personal shopper<ArrowRight aria-hidden="true" /></Button>
      </div>
      <details className="costume-sourcing">
        <summary>Find a lower-price outfit<ChevronDown size={16} aria-hidden="true" /></summary>
        <p>Compare the lowest-priced available picks in our catalog.</p>
        {restoreState === "ready" && <ShopForMe pieces={sourcingPieces} onComplete={(choices) => {
          for (const view of pieces) {
            const index = choices[view.piece.id];
            if (index !== undefined) choose(view, index);
          }
        }} />}
      </details>

      {restoreState === "ready" && <AssistantPanel costume={costume} onChoose={(pieceId, productId) => {
        setUses((current) => ({ ...current, [pieceId]: "buy" }));
        const view = pieces.find(({ piece }) => piece.id === pieceId);
        const index = view?.options.findIndex(({ product }) => product.id === productId) ?? -1;
        if (index >= 0) setChosen((current) => ({ ...current, [pieceId]: index }));
      }} />}
    </div>
  </div>;
}

function openMerchant(event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const popup = window.open("", "_blank", "popup,width=1100,height=800");
  // Keep the native link fallback when popups are blocked. Isolate the new window before loading the merchant.
  if (!popup) return;
  popup.opener = null;
  popup.location.replace(event.currentTarget.href);
  event.preventDefault();
}

function PieceRow({ purchaseReady, costumeSlug, view, index, use, onUse, recoveryOpen, onRecoveryClose, onAdd, onChoose }: { purchaseReady: boolean; costumeSlug: string; view: PieceView; index: number; use: "buy" | "owned" | "skip"; onUse: (use: "buy" | "owned" | "skip") => void; recoveryOpen: boolean; onRecoveryClose: () => void; onAdd: () => void; onChoose: (index: number) => void }) {
  const cart = useCart();
  const [open, setOpen] = useState(false);
  const { piece, options } = view;
  const option = options[index] ?? options[0];
  if (!option) return <li className="outfit-piece"><p>{piece.name}</p><p className="meta">No available pick. Ask the assistant for help.</p></li>;
  const inCart = cart.ready && cart.costumeSlug === costumeSlug && cart.items.some((line) => line.pieceId === piece.id && line.productId === option.product.id);

  return <li className="outfit-piece">
    <Dialog open={open || recoveryOpen} onOpenChange={(next) => { setOpen(next); if (!next) onRecoveryClose(); }}>
      <div className="outfit-piece-row">
        <a className="outfit-piece-trigger" href={option.product.url} target="_blank" rel="noopener noreferrer" onClick={openMerchant} aria-label={`View ${piece.name} at ${option.merchant.name} (opens in a new window)`}>
          <span className="outfit-piece-image"><ProductImage src={shot(option.product)} alt="" /></span>
          <span className="outfit-piece-copy"><span className="outfit-piece-name">{piece.name}</span><span className="outfit-piece-product">{option.product.title}</span><span className="outfit-piece-merchant">{option.merchant.name}{option.pick.isLocal ? " · Local" : ""}{option.product.availability === "out_of_stock" ? " · Sold out" : ""}</span></span>
        </a>
        <div className="outfit-piece-side">
          <a href={option.product.url} target="_blank" rel="noopener noreferrer" onClick={openMerchant} aria-label={`View ${piece.name} for ${formatPrice(option.product.priceCents)} (opens in a new window)`}>{formatPrice(option.product.priceCents)}</a>
          <DialogTrigger asChild>
            <button type="button" className="outfit-piece-change" aria-label={`Change ${piece.name}`}>Change<ChevronRight size={14} aria-hidden="true" /></button>
          </DialogTrigger>
        </div>
      </div>
      <label className="piece-use">Use this piece<select aria-label={`Use ${piece.name}`} disabled={!purchaseReady} value={use} onChange={event => onUse(event.target.value as "buy" | "owned" | "skip")}><option value="buy">Buy this piece</option><option value="owned">Already own</option>{!piece.required && <option value="skip">Skip this piece</option>}</select></label>
      <DialogContent className="piece-dialog wardrobe-rail-dialog">
        <div className="piece-dialog-heading"><DialogTitle>{piece.name}</DialogTitle><DialogDescription>Choose the piece that suits your style and budget.</DialogDescription></div>
        <WardrobeRail view={view} selectedId={option.product.id} onChoose={onChoose} />
        <details className="piece-reason"><summary>Why this pick?</summary><p>{option.pick.reason}</p></details>
        <a className="piece-merchant-link" href={option.product.url} target="_blank" rel="noopener noreferrer" onClick={openMerchant}>View at {option.merchant.name}<ArrowRight size={14} aria-hidden="true" /></a>
        <div className="piece-dialog-footer">
          <Button variant="outline" disabled={!purchaseReady || !cart.ready || inCart || use !== "buy" || option.product.availability === "out_of_stock"} onClick={onAdd}>{inCart ? <><Check aria-hidden="true" />In cart</> : "Add this piece"}</Button>
          <DialogClose asChild><Button>Done</Button></DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  </li>;
}
