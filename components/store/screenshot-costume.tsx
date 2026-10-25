"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { SCREENSHOT_SLUG, formatPrice, useCart } from "@/lib/cart/context";
import type { CartItem } from "@/lib/types";
import { preparePhoto } from "@/lib/photo/prepare";
import { AssemblyPlaceholder, AssemblyStatus } from "./assembly-status";
import "./screenshot-costume.css";

interface LookPiece { name: string; slot: string; query: string; sizeKind: CartItem["sizeKind"] }
type Slot =
  | { state: "looking"; name: string }
  | { state: "found"; name: string; item: CartItem }
  | { state: "missing"; name: string };
interface LogLine { kind: string; text: string; ms: number }
type Phase = "idle" | "running" | "done" | "error";

// Small rotations make the pieces land like a hand-arranged flat-lay.
const TILT = [-2.5, 1.8, -1.2, 2.4, -1.9, 1.1, -0.8];

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
  const [shown, setShown] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const queue = useRef<LogLine[]>([]);
  const logRef = useRef<HTMLOListElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Coming back from the cart shows the look that is already in it.
  const restored = phase === "idle" && cart.ready && cart.costumeSlug === SCREENSHOT_SLUG && slots.length === 0;
  const visible: Slot[] = restored ? cart.items.map((item) => ({ state: "found", name: item.pieceName, item })) : slots;
  const found = visible.flatMap((slot) => slot.state === "found" ? [slot.item] : []);
  const total = found.reduce((sum, item) => sum + item.priceCents, 0);
  const inCart = (pieceId: string) => cart.costumeSlug === SCREENSHOT_SLUG && cart.items.some((line) => line.pieceId === pieceId);
  const sizeOf = (item: CartItem) => cart.items.find((line) => cart.costumeSlug === SCREENSHOT_SLUG && line.pieceId === item.pieceId)?.size ?? sizes[item.pieceId] ?? null;

  // Lines arrive in bursts, so drip them out to keep the log readable.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = queue.current.shift();
      if (next) setLog((lines) => [...lines, next]);
    }, 60);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [log]);

  useEffect(() => {
    if (shown === total) return;
    const frame = requestAnimationFrame(() => setShown((s) => Math.abs(total - s) < 50 ? total : Math.round(s + (total - s) * 0.18)));
    return () => cancelAnimationFrame(frame);
  }, [shown, total]);

  useEffect(() => () => abort.current?.abort(), []);

  const run = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) { setError("That file isn’t an image. Try a PNG or JPEG screenshot."); return; }
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(file); });
    setPhase("running"); setError(null); setCharacter(null); setSummary(""); setSlots([]); setSizes({}); setLog([]);
    queue.current = [];

    const form = new FormData();
    try {
      // Keep phone screenshots below the deployed function's upload limit.
      const photo = await preparePhoto(file);
      if (controller.signal.aborted) return;
      form.append("photo", photo, "screenshot.jpg");
      const response = await fetch("/api/screenshot-costume", { method: "POST", body: form, signal: controller.signal });
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
          } else if (event.t === "piece") {
            const item = event.item as CartItem;
            setSlots((current) => current.map((slot, i) => i === event.i ? { state: "found", name: slot.name, item } : slot));
          } else if (event.t === "miss") {
            setSlots((current) => current.map((slot, i) => i === event.i ? { state: "missing", name: slot.name } : slot));
          } else if (event.t === "done") {
            finished = true;
            queue.current.push({ kind: "done", text: `Done in ${(event.ms / 1000).toFixed(1)}s`, ms: event.ms });
            setPhase("done");
          } else if (event.t === "error") {
            throw new Error(String(event.text));
          }
        }
      }
      if (!finished) throw new Error("The stylist stopped early. Please try again.");
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "The stylist couldn’t finish this look.");
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
    if (inCart(item.pieceId)) cart.setSize(item.pieceId, value);
  }

  function addLook() {
    cart.addMany(found.map((item) => ({ ...item, size: sizeOf(item) })), SCREENSHOT_SLUG);
    cart.setOpen(true);
  }

  const running = phase === "running";
  const allInCart = found.length > 0 && found.every((item) => inCart(item.pieceId));
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

    <section className="shot-result" aria-busy={running}>
      <div className="shot-head">
        <div>
          <p className="meta">Screenshot to costume</p>
          <h1>{character ?? (restored ? "Your screenshot look" : running ? "Reading the look…" : "Turn any screenshot into a costume.")}</h1>
          <p className="shot-summary">{summary || (restored ? "These pieces are in your cart. Pick sizes, then check out." : !character && !running ? "We spot who it is, break the outfit into the pieces you’d actually buy, and find each one in stock at a real shop." : "")}</p>
        </div>
        {found.length > 0 && <div className="shot-total"><span className="meta">{found.length} {found.length === 1 ? "piece" : "pieces"}</span><strong>{formatPrice(shown)}</strong></div>}
      </div>

      {error && <p className="notice" role="alert">{error}</p>}

      {(running || visible.length > 0) && <AssemblyStatus found={found.length} total={visible.length} missing={missing} running={running} stopped={phase === "error"} />}
      {running && visible.length === 0 && <div className="shot-preparing" aria-hidden="true">
        <span className="shot-preparing-sheet" />
        <span className="shot-preparing-sheet" />
        <span className="shot-preparing-sheet" />
        <p>Making room for your look</p>
      </div>}
      {visible.length > 0 ? <ul className="shot-lay">
        {visible.map((slot, i) => <li key={i} className={`shot-slot is-${slot.state}`} style={{ "--r": `${TILT[i % TILT.length]}deg` } as CSSProperties}>
          <div className="shot-frame">
            {slot.state === "found"
              // eslint-disable-next-line @next/next/no-img-element -- merchant images come from any shop's CDN
              ? <img src={slot.item.image} alt={slot.item.title} referrerPolicy="no-referrer" />
              : <AssemblyPlaceholder state={slot.state === "looking" && phase === "error" ? "stopped" : slot.state} index={i} />}
          </div>
          <div className="shot-caption">
            <p className="shot-piece">{slot.name}</p>
            {slot.state === "found" && <>
              <a href={slot.item.productUrl} target="_blank" rel="noopener noreferrer">{slot.item.title}</a>
              <p className="meta">{slot.item.merchantName} · {formatPrice(slot.item.priceCents)}</p>
              {slot.item.sizeKind !== "one_size" && slot.item.availableSizes.length > 0 && <select
                className="shot-size" aria-label={`Size for ${slot.name}`}
                value={sizeOf(slot.item) ?? ""} onChange={(event) => chooseSize(slot.item, event.target.value)}>
                <option value="">Pick a size</option>
                {slot.item.availableSizes.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>}
            </>}
          </div>
        </li>)}
      </ul> : !running && <div className="shot-empty" aria-hidden="true">{TILT.slice(0, 6).map((r, i) => <span key={i} style={{ "--r": `${r}deg` } as CSSProperties} />)}</div>}

      {found.length > 0 && !running && <div className="shot-foot">
        <p className="meta">{missing > 0 ? `${missing} ${missing === 1 ? "piece still needs" : "pieces still need"} a verified match. ` : ""}Prices and stock are checked again at checkout.</p>
        <button type="button" className="btn" onClick={allInCart ? () => cart.setOpen(true) : addLook}>
          {allInCart ? "View cart" : `Add the look to cart · ${formatPrice(total)}`}
        </button>
      </div>}
    </section>
  </div>;
}
