"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { SCREENSHOT_SLUG, formatPrice, useCart } from "@/lib/cart/context";
import { compatibleSize } from "@/lib/cart/item";
import type { ScreenshotMatch } from "@/lib/sourcing/screenshot-types";
import type { CartItem } from "@/lib/types";
import { preparePhoto } from "@/lib/photo/prepare";
import { AssemblyPlaceholder, AssemblyStatus } from "./assembly-status";
import { PieceInspectionPanel } from "./piece-inspection-panel";
import "./screenshot-costume.css";

interface LookPiece { name: string; slot: string; query: string; sizeKind: CartItem["sizeKind"] }
type Slot =
  | { state: "looking"; name: string }
  | { state: "found"; name: string; item: CartItem; why?: string }
  | { state: "candidate"; name: string; match: ScreenshotMatch }
  | { state: "missing"; name: string };
interface LogLine { kind: string; text: string; ms: number }
type Phase = "idle" | "running" | "done" | "error";

// Small rotations make the pieces land like a hand-arranged flat-lay.
const TILT = [-2.5, 1.8, -1.2, 2.4, -1.9, 1.1, -0.8];

function MatchImage({ src, title, merchant }: { src: string | null; title: string; merchant: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <span className="shot-discovery-photo"><span>{src ? "Photo unavailable" : "Similar item found"}</span><strong>{merchant}</strong><span>View at shop ↗</span></span>;
  // eslint-disable-next-line @next/next/no-img-element -- merchant photos can use any public CDN
  return <img src={src} alt={title} referrerPolicy="no-referrer" onError={() => setFailed(src)} />;
}

function matchPrice(match: ScreenshotMatch) {
  if (match.priceCents && match.currency && /^[A-Z]{3}$/.test(match.currency)) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: match.currency }).format(match.priceCents / 100);
  }
  return "Check price at shop";
}

export function ScreenshotCostume() {
  const cart = useCart();
  const [preview, setPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [character, setCharacter] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sizes, setSizes] = useState<Record<string, string | null>>({});
  const [dragging, setDragging] = useState(false);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const inspectionTrigger = useRef<HTMLButtonElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const queue = useRef<LogLine[]>([]);
  const logRef = useRef<HTMLOListElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Coming back from the cart shows the look that is already in it.
  const restored = phase === "idle" && cart.ready && cart.costumeSlug === SCREENSHOT_SLUG && slots.length === 0;
  const visible: Slot[] = restored ? cart.items.map((item) => ({ state: "found", name: item.pieceName, item })) : slots;
  const found = visible.flatMap((slot) => slot.state === "found" ? [slot.item] : []);
  const discovered = visible.filter(slot => slot.state === "found" || slot.state === "candidate").length;
  const selected = found.find((item) => item.pieceId === selectedPieceId) ?? null;
  const total = found.reduce((sum, item) => sum + item.priceCents, 0);
  const inCart = (item: CartItem) => cart.costumeSlug === SCREENSHOT_SLUG && cart.items.some((line) => line.pieceId === item.pieceId && line.productId === item.productId);
  const sizeOf = (item: CartItem) => compatibleSize(item, cart.items.find((line) => cart.costumeSlug === SCREENSHOT_SLUG && line.pieceId === item.pieceId && line.productId === item.productId)?.size ?? sizes[item.pieceId]);

  // Flush bursts together so the log never trails the results by several seconds.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const batch = queue.current.splice(0);
      if (batch.length) setLog(lines => [...lines, ...batch]);
    }, 60);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [log]);

  useEffect(() => () => abort.current?.abort(), []);

  const run = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) { setError("That file isn’t an image. Try a PNG or JPEG screenshot."); return; }
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(file); });
    setPhase("running"); setError(null); setCharacter(null); setSummary(""); setSlots([]); setSizes({}); setLog([]); setSelectedPieceId(null);
    queue.current = [];

    const form = new FormData();
    try {
      // Keep phone screenshots below the deployed function's upload limit.
      const photo = await preparePhoto(file);
      if (controller.signal.aborted) return;
      form.append("photo", photo, "screenshot.jpg");
      const response = await fetch("/api/screenshot-costume", { method: "POST", body: form, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]) });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "The stylist is unavailable right now.");
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let finished = false;
      while (true) {
        const { value, done } = await reader.read();
        if (controller.signal.aborted) return;
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (!raw.trim()) continue;
          const event = JSON.parse(raw) as Record<string, unknown> & { t: string; ms: number };
          if (event.t === "log") queue.current.push({ kind: String(event.kind), text: String(event.text), ms: event.ms });
          else if (event.t === "look") {
            setCharacter(String(event.character));
            setSummary(String(event.summary ?? ""));
            setSlots((event.pieces as LookPiece[]).map((piece) => ({ state: "looking", name: piece.name })));
          } else if (event.t === "candidate") {
            const match = event.match as ScreenshotMatch;
            setSlots(current => current.map((slot, i) => i === event.i && slot.state !== "found" ? { state: "candidate", name: slot.name, match } : slot));
          } else if (event.t === "piece") {
            const item = event.item as CartItem;
            setSlots((current) => current.map((slot, i) => i === event.i ? { state: "found", name: slot.name, item, why: typeof event.why === "string" ? event.why : undefined } : slot));
          } else if (event.t === "miss") {
            setSlots((current) => current.map((slot, i) => i === event.i ? { state: "missing", name: slot.name } : slot));
          } else if (event.t === "done") {
            finished = true;
            queue.current.push({ kind: "done", text: `Done in ${(event.ms / 1000).toFixed(1)}s`, ms: event.ms });
            setSlots(current => current.map(slot => slot.state === "looking" ? { state: "missing", name: slot.name } : slot));
            setPhase("done");
          } else if (event.t === "error") {
            throw new Error(String(event.text));
          }
        }
      }
      if (!finished) throw new Error("The search stopped early. Matches already found stay on your board.");
    } catch (caught) {
      if (controller.signal.aborted) return;
      // The terminal phase renders pending pieces as unfinished, not verified misses.
      setError(caught instanceof Error && caught.name === "TimeoutError" ? "The search reached its time limit. Matches already found stay on your board." : caught instanceof Error ? caught.message : "The stylist couldn’t finish this look.");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) { event.preventDefault(); void run(file); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [run]);

  function chooseSize(item: CartItem, size: string) {
    const value = size || null;
    setSizes((current) => ({ ...current, [item.pieceId]: value }));
    if (inCart(item)) cart.setSize(item.pieceId, value);
  }

  const replacesScreenshot = cart.costumeSlug === SCREENSHOT_SLUG && cart.items.some((line) => !found.some((item) => item.pieceId === line.pieceId && item.productId === line.productId));

  function addLook() {
    // Screenshot uploads share one cart slug, so remove lines belonging to an earlier image.
    if (replacesScreenshot) cart.clear();
    cart.addMany(found.map((item) => ({ ...item, size: sizeOf(item) })), SCREENSHOT_SLUG);
    cart.setOpen(true);
  }

  function closeInspection() {
    setSelectedPieceId(null);
    inspectionTrigger.current?.focus();
  }

  function addSelected() {
    if (!selected || !cart.ready) return;
    if (replacesScreenshot) cart.clear();
    if (!inCart(selected) || replacesScreenshot) cart.add({ ...selected, size: sizeOf(selected) }, SCREENSHOT_SLUG);
    cart.setOpen(true);
  }

  const running = phase === "running";
  const allInCart = !replacesScreenshot && found.length > 0 && found.every((item) => inCart(item));
  const missing = visible.filter((slot) => slot.state === "missing").length;

  return <div className="page shot">
    <aside className="shot-input">
      <label
        className={`shot-drop ${dragging ? "is-over" : ""} ${preview ? "has-image" : ""} ${running ? "is-scanning" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault(); setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void run(file);
        }}
      >
        <input ref={fileRef} type="file" accept="image/*" className="shot-file" disabled={running}
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void run(file); event.target.value = ""; }} />
        {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not a remote asset */}
        {preview ? <img src={preview} alt="Your screenshot" /> : <span className="shot-drop-hint">
          <strong>Drop a screenshot</strong>
          <span>or paste it, or click to choose one. A movie still, a TikTok, a celebrity on a red carpet.</span>
        </span>}
      </label>
      {preview && <button type="button" className="btn btn-ghost btn-block" disabled={running} onClick={() => fileRef.current?.click()}>Try another screenshot</button>}
      {(log.length > 0 || running) && <ol className="shot-log" ref={logRef} aria-live="polite" aria-label="Sourcing log">
        {log.map((line, i) => <li key={i} className={`is-${line.kind}`}><span>{(line.ms / 1000).toFixed(1)}s</span>{line.text}</li>)}
        {running && <li className="is-cursor" aria-hidden="true"><span /></li>}
      </ol>}
    </aside>

    <section className="shot-result" aria-label="Screenshot results">
      <div className="shot-head">
        <div>
          <p className="meta">Screenshot to costume</p>
          <h1>{character ?? (restored ? "Your screenshot look" : running ? "Reading the look…" : "Turn any screenshot into a costume.")}</h1>
          <p className="shot-summary">{summary || (restored ? "These pieces are in your cart. Pick sizes, then check out." : !character && !running ? "We read the outfit, break it into pieces, and find similar items at real shops. Matches appear as we find them, within 30 seconds." : "")}</p>
        </div>
        {found.length > 0 && <div className="shot-total"><span className="meta">{found.length} priced {found.length === 1 ? "piece" : "pieces"}</span><strong>{formatPrice(total)}</strong></div>}
      </div>

      {error && <p className="notice" role="alert">{error}</p>}

      {(running || visible.length > 0) && <AssemblyStatus discovery found={discovered} total={visible.length} missing={missing} running={running} stopped={phase === "error"} />}
      {running && visible.length === 0 && <div className="shot-preparing" aria-hidden="true">
        <span className="shot-preparing-sheet" />
        <span className="shot-preparing-sheet" />
        <span className="shot-preparing-sheet" />
        <p>Making room for your look</p>
      </div>}
      {visible.length > 0 ? <div className={`shot-workbench ${selected ? "has-selection" : ""}`}>
        <ul className="shot-lay">
        {visible.map((slot, i) => <li key={i} className={`shot-slot is-${slot.state} ${slot.state === "found" && selected?.pieceId === slot.item.pieceId ? "is-selected" : ""}`} style={{ "--r": `${TILT[i % TILT.length]}deg` } as CSSProperties}>
          {slot.state === "found" ? <>
            <button type="button" className="shot-inspect"
              aria-label={`Inspect ${slot.name}`} aria-expanded={selected?.pieceId === slot.item.pieceId}
              aria-controls={selected?.pieceId === slot.item.pieceId ? "screenshot-piece-inspection" : undefined}
              onClick={(event) => {
                inspectionTrigger.current = event.currentTarget;
                if (selected?.pieceId === slot.item.pieceId) closeInspection();
                else setSelectedPieceId(slot.item.pieceId);
              }}>
              <span className="shot-frame">
                <MatchImage src={slot.item.image} title={slot.item.title} merchant={slot.item.merchantName} />
              </span>
              <span className="shot-caption">
                <span className="shot-piece">{slot.name}</span>
                <span className="shot-title">{slot.item.title}</span>
                <span className="meta">{slot.item.merchantName} · {formatPrice(slot.item.priceCents)}</span>
                {slot.why && <span className="meta shot-match">{slot.why}</span>}
                <span className="shot-inspect-hint">{selected?.pieceId === slot.item.pieceId ? "Viewing details" : "Inspect piece"}</span>
              </span>
            </button>
            {slot.item.sizeKind !== "one_size" && slot.item.availableSizes.length > 0 && <select
                className="shot-size" aria-label={`Size for ${slot.name}`}
                value={sizeOf(slot.item) ?? ""} onChange={(event) => chooseSize(slot.item, event.target.value)}>
                <option value="">Pick a size</option>
                {slot.item.availableSizes.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>}
          </> : slot.state === "candidate" ? <a className="shot-inspect" href={slot.match.url} target="_blank" rel="noopener noreferrer">
            <span className="shot-frame">
              <MatchImage src={slot.match.image} title={slot.match.title} merchant={slot.match.merchant} />
            </span>
            <span className="shot-caption"><span className="shot-piece">{slot.name}</span><span className="shot-title">{slot.match.title}</span>
              <span className="meta">{slot.match.merchant} · {matchPrice(slot.match)}</span>
              <span className="meta shot-match">{slot.match.note}</span>
              <span className="shot-inspect-hint">{slot.match.availability === "out_of_stock" ? "Listed out of stock · check shop ↗" : slot.match.kind === "browse" ? "Browse matches at shop ↗" : "View at shop ↗"}</span></span>
          </a> : <>
            <div className="shot-frame"><AssemblyPlaceholder state={slot.state === "looking" && phase === "error" ? "stopped" : slot.state} index={i} /></div>
            <div className="shot-caption"><p className="shot-piece">{slot.name}</p></div>
          </>}
        </li>)}
        </ul>
        {selected && <PieceInspectionPanel id="screenshot-piece-inspection" item={selected}
          size={sizeOf(selected)} inCart={inCart(selected) && !replacesScreenshot} addDisabled={!cart.ready}
          onSizeChange={(size) => chooseSize(selected, size)} onAdd={addSelected} onClose={closeInspection} />}
      </div> : !running && <div className="shot-empty" aria-hidden="true">{TILT.slice(0, 6).map((r, i) => <span key={i} style={{ "--r": `${r}deg` } as CSSProperties} />)}</div>}

      {discovered > 0 && <div className="shot-foot">
        <p className="meta">{replacesScreenshot ? "This replaces the previous screenshot look in your cart. " : ""}{discovered > found.length ? "Open shop links for items without confirmed prices. " : ""}{missing > 0 ? `${missing} ${missing === 1 ? "piece needs" : "pieces need"} another search. ` : ""}Prices and stock can change. Checkout checks cart items again.</p>
        {found.length > 0 && <button type="button" className="btn" disabled={!cart.ready} onClick={allInCart ? () => cart.setOpen(true) : addLook}>
          {allInCart ? "View cart" : `Add ${found.length < visible.length ? "priced pieces" : "the look"} to cart · ${formatPrice(total)}`}
        </button>}
      </div>}
    </section>
  </div>;
}
