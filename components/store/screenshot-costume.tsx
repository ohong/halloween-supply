"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { SCREENSHOT_SLUG, formatPrice, useCart } from "@/lib/cart/context";
import { compatibleSize } from "@/lib/cart/item";
import type { ScreenshotMatch } from "@/lib/sourcing/screenshot-types";
import type { CartItem } from "@/lib/types";
import type { CustomLook, CustomPiece } from "@/lib/custom-looks/types";
import { useCostumeModel } from "@/lib/model-selection";
import { PhoneCameraProvider } from "./phone-camera";
import { VirtualTryOn } from "./virtual-try-on";
import { ClipInput } from "./clip-input";
import { useLocalProductSizes } from "./local-product-sizes";
import { trackEvent } from "@/lib/telemetry/client";
import { preparePhoto } from "@/lib/photo/prepare";
import { AssemblyPlaceholder, AssemblyStatus } from "./assembly-status";
import { PieceInspectionPanel } from "./piece-inspection-panel";
import { PieceDot, PieceVision, PipelineStrip, SegmentationOverlay, type PieceVisionInfo, type Segmentation } from "./segmentation-view";
import "./screenshot-costume.css";

type LookPiece = CustomPiece;
type Slot =
  | { state: "looking"; name: string }
  | { state: "found"; name: string; item: CartItem; why?: string; proof?: string }
  | { state: "candidate"; name: string; match: ScreenshotMatch }
  | { state: "approval"; name: string; item: CartItem; why?: string; because: string; proof?: string }
  | { state: "missing"; name: string };
type VisionInfo = PieceVisionInfo;
interface TraceStep { piece: number | null; step: string; detail: Record<string, unknown> }
interface ScoredResult { title: string; score: number; verdict: string; reasons: string[] }
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

const BECAUSE: Record<string, string> = {
  retries_exhausted: "No confident match after two retries.",
  budget_low: "The search ran out of time before a confident match.",
  no_new_query: "No other search left to try.",
  opencv_unavailable: "Photo scoring was unavailable.",
};
const words = (text: unknown) => String(text).replaceAll("_", " ");

function traceLine(entry: TraceStep) {
  const d = entry.detail;
  if (entry.step === "search") return `Searched “${d.query}”: ${d.candidates} ${d.candidates === 1 ? "result" : "results"}`;
  if (entry.step === "score") {
    const results = (d.results as ScoredResult[]).toSorted((a, b) => b.score - a.score).slice(0, 3);
    return results.length ? `Scored: ${results.map(r => `${r.score.toFixed(2)} ${r.verdict}${r.reasons.length ? ` (${r.reasons.map(words).join(", ")})` : ""}`).join(" · ")}` : "No product photos to score";
  }
  if (entry.step === "decide") return d.action === "retry" ? `Retry for ${words(d.because)}: “${d.next}”` : d.action === "accept" ? "Accepted the best match" : "Asked for your OK";
  return null;
}

/** Shows the OpenCV evidence behind one piece: the crop, its colors and each step the agent took. */
function MatchTrace({ vision, trace, index }: { vision?: VisionInfo; trace: TraceStep[]; index: number }) {
  if (!vision) return null;
  return <details className="shot-how">
    <summary>{vision.region && <><PieceDot index={index} />&nbsp;</>}How we matched this</summary>
    <div className="shot-how-body">
      {!vision.region && <>
        {/* eslint-disable-next-line @next/next/no-img-element -- a data URL crop from the vision service */}
        <img src={vision.crop} alt="The piece as OpenCV cropped it" />
        <ul className="shot-swatches" aria-label="Colors found">
          {vision.colors.map(c => <li key={c.hex}><span style={{ background: c.hex }} />{c.name} {Math.round(c.frac * 100)}%</li>)}
        </ul>
        {vision.garmentTypes[0] && <p className="meta">Looks like: {vision.garmentTypes.slice(0, 3).map(g => `${g.phrase} ${g.score.toFixed(2)}`).join(", ")}</p>}
      </>}
      <ol className="shot-steps">{trace.map((entry, i) => { const line = traceLine(entry); return line && <li key={i}>{line}</li>; })}</ol>
    </div>
  </details>;
}

function matchPrice(match: ScreenshotMatch) {
  if (match.priceCents && match.currency && /^[A-Z]{3}$/.test(match.currency)) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: match.currency }).format(match.priceCents / 100);
  }
  return "Check price at shop";
}

export function ScreenshotCostume() {
  const cart = useCart();
  const { model } = useCostumeModel();
  const [pieceSpecs, setPieceSpecs] = useState<LookPiece[]>([]);
  const [boardRequestId, setBoardRequestId] = useState<string | null>(null);
  const [savedLook, setSavedLook] = useState<CustomLook | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedPayload, setSavedPayload] = useState<string | null>(null);
  const retryKeys = useRef<Record<string, string>>({});
  const [saveError, setSaveError] = useState("");
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [retrying, setRetrying] = useState<number | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const boardVersion = useRef(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [character, setCharacter] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { sizes, setSize } = useLocalProductSizes();
  const [dragging, setDragging] = useState(false);
  const [vision, setVision] = useState<VisionInfo[]>([]);
  const [segmentation, setSegmentation] = useState<Segmentation | null>(null);
  const [activePiece, setActivePiece] = useState<number | null>(null);
  const [traces, setTraces] = useState<Record<number, TraceStep[]>>({});
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
  const discovered = visible.filter(slot => slot.state === "found" || slot.state === "candidate" || slot.state === "approval").length;
  const pending = visible.filter(slot => slot.state === "approval").length;
  const selected = found.find((item) => item.pieceId === selectedPieceId) ?? null;
  const total = found.reduce((sum, item) => sum + item.priceCents, 0);
  const source = savedLook ? `custom-look:${savedLook.id}` : SCREENSHOT_SLUG;
  const inCart = (item: CartItem) => cart.costumeSlug === source && cart.items.some((line) => line.pieceId === item.pieceId && line.productId === item.productId);
  const sizeOf = (item: CartItem) => {
    const current = cart.items.find(line => cart.costumeSlug === source && line.pieceId === item.pieceId && line.productId === item.productId);
    return compatibleSize(item, current ? current.size : sizes[item.productId]);
  };

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
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("saved");
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
    const controller = new AbortController();
    const version = boardVersion.current;
    void fetch(`/api/saved-looks/${id}`, { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok || !data.look) throw new Error(data.error ?? "This saved board could not be opened.");
      if (version !== boardVersion.current) return;
      const look = data.look as CustomLook;
      setSavedLook(look); setCharacter(look.name); setSummary(look.summary);
      setPieceSpecs(look.pieces.map(row => row.piece));
      setSlots(look.pieces.map(row => row.item ? { state: "found", name: row.piece.name, item: row.item } : { state: "missing", name: row.piece.name }));
      setPhase("done");
    }).catch(error => { if (!controller.signal.aborted) setSaveError(error instanceof Error ? error.message : "This saved board could not be opened."); });
    return () => controller.abort();
  }, []);

  // Only signed, accepted products enter the durable board. Photos remain in memory.
  const savePayload = boardRequestId && phase !== "running" && phase !== "idle" && found.length > 0 && pieceSpecs.length === slots.length
    ? JSON.stringify({ requestId: boardRequestId, name: (character ?? "Your screenshot look").slice(0, 160), summary: summary.slice(0, 240), model,
      pieces: pieceSpecs.map((piece, index) => { const slot = slots[index]; const spec = { name: piece.name, slot: piece.slot, query: piece.query, sizeKind: piece.sizeKind }; return slot?.state === "found" ? { piece: { ...spec, name: slot.item.pieceName, sizeKind: slot.item.sizeKind }, item: slot.item, proof: slot.proof } : { piece: spec, item: null }; }) }) : null;
  const boardSynced = !boardRequestId || savePayload !== null && savedPayload === savePayload;
  useEffect(() => {
    if (!savePayload) return;
    let active = true;
    const version = boardVersion.current;
    const timer = window.setTimeout(() => {
      setSaving(true); setSaveError("");
      saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
        if (version !== boardVersion.current) return;
        try {
          const response = await fetch("/api/saved-looks", { method: "POST", headers: { "Content-Type": "application/json" }, body: savePayload });
          const data = await response.json();
          if (!response.ok || !data.look) throw new Error(data.error ?? "The board could not be saved. Your found pieces remain here.");
          if (!active || version !== boardVersion.current) return;
          setSavedLook(data.look); setSavedPayload(savePayload);
          const url = new URL(window.location.href); url.searchParams.set("saved", data.look.id);
          window.history.replaceState(null, "", url);
        } catch (error) { if (active && version === boardVersion.current) setSaveError(error instanceof Error ? error.message : "The board could not be saved."); }
        finally { if (active && version === boardVersion.current) setSaving(false); }
      });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [savePayload, saveAttempt]);

  async function retryPiece(pieceIndex: number) {
    if (!savedLook || retrying !== null || !boardSynced) return;
    const version = boardVersion.current;
    const key = `${savedLook.id}:${pieceIndex}`;
    const requestId = retryKeys.current[key] ??= crypto.randomUUID();
    setRetrying(pieceIndex); setSaveError("");
    try {
      const response = await fetch(`/api/saved-looks/${savedLook.id}/retry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, pieceIndex }) });
      const data = await response.json();
      if (!response.ok || !data.look) throw new Error(data.error ?? "This piece could not be searched again.");
      if (version !== boardVersion.current) return;
      delete retryKeys.current[key];
      boardVersion.current++;
      const look = data.look as CustomLook;
      setBoardRequestId(null); setSavedLook(look); setPieceSpecs(look.pieces.map(row => row.piece));
      setSlots(look.pieces.map(row => row.item ? { state: "found", name: row.piece.name, item: row.item } : { state: "missing", name: row.piece.name }));
      const url = new URL(window.location.href); url.searchParams.set("saved", look.id); window.history.replaceState(null, "", url);
      if (look.error) setSaveError(look.error);
    } catch (error) { setSaveError(error instanceof Error ? error.message : "This piece could not be searched again."); }
    finally { setRetrying(null); }
  }


  const runStream = useCallback(async (input: File | FormData, previewUrl: string | null, endpoint: string) => {
    const started = performance.now();
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    boardVersion.current++;
    setBoardRequestId(crypto.randomUUID()); setSavedLook(null); setSavedPayload(null); setPieceSpecs([]); setSaveError(""); setSaving(false);
    const url = new URL(window.location.href); url.searchParams.delete("saved"); window.history.replaceState(null, "", url);
    setPreview(previewUrl);
    setPhase("running"); setError(null); setCharacter(null); setSummary(""); setSlots([]); setLog([]); setSelectedPieceId(null); setVision([]); setTraces({}); setSegmentation(null); setActivePiece(null);
    queue.current = [];

    const form = input instanceof FormData ? input : new FormData();
    try {
      if (input instanceof File) {
        // Keep phone screenshots below the deployed function's upload limit.
        const photo = await preparePhoto(input);
        if (controller.signal.aborted) return;
        form.append("photo", photo, "screenshot.jpg");
      }
      const response = await fetch(endpoint, { method: "POST", body: form, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(endpoint === "/api/clip-costume" ? 140_000 : 35_000)]) });
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
            setPieceSpecs(event.pieces as LookPiece[]);
            setSlots((event.pieces as LookPiece[]).map((piece) => ({ state: "looking", name: piece.name })));
            setVision((event.vision as VisionInfo[] | undefined) ?? []);
            setSegmentation((event.segmentation as Segmentation | undefined) ?? null);
          } else if (event.t === "trace") {
            const entry = event as unknown as TraceStep;
            if (entry.piece !== null) setTraces(current => ({ ...current, [entry.piece!]: [...(current[entry.piece!] ?? []), entry] }));
          } else if (event.t === "approval") {
            const item = event.item as CartItem;
            setSlots(current => current.map((slot, i) => i === event.i ? { state: "approval", name: slot.name, item, why: typeof event.why === "string" ? event.why : undefined, because: String(event.because), proof: typeof event.proof === "string" ? event.proof : undefined } : slot));
          } else if (event.t === "candidate") {
            const match = event.match as ScreenshotMatch;
            setSlots(current => current.map((slot, i) => i === event.i && slot.state !== "found" && slot.state !== "approval" ? { state: "candidate", name: slot.name, match } : slot));
          } else if (event.t === "piece") {
            const item = event.item as CartItem;
            setSlots((current) => current.map((slot, i) => i === event.i ? { state: "found", name: slot.name, item, why: typeof event.why === "string" ? event.why : undefined, proof: typeof event.proof === "string" ? event.proof : undefined } : slot));
          } else if (event.t === "miss") {
            setSlots((current) => current.map((slot, i) => i === event.i ? { state: "missing", name: slot.name } : slot));
          } else if (event.t === "done") {
            finished = true;
            trackEvent("source_timing", { source: "screenshot", mode: endpoint === "/api/clip-costume" ? "video" : "screenshot", stage: "complete", durationMs: Math.round(performance.now() - started) });
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
      trackEvent("source_timing", { source: "screenshot", mode: endpoint === "/api/clip-costume" ? "video" : "screenshot", stage: "failure", durationMs: Math.round(performance.now() - started) });
    }
  }, []);

  const run = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) { setError("That file isn’t an image. Try a PNG or JPEG screenshot."); return; }
    await runStream(file, URL.createObjectURL(file), "/api/screenshot-costume");
  }, [runStream]);

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
    setSize(item.productId, value);
    if (inCart(item)) cart.setSize(item.pieceId, value);
  }

  const replacesScreenshot = cart.costumeSlug === source && cart.items.some((line) => !found.some((item) => item.pieceId === line.pieceId && item.productId === line.productId));

  function addLook() {
    // Screenshot uploads share one cart slug, so remove lines belonging to an earlier image.
    if (replacesScreenshot) cart.clear();
    cart.addMany(found.map((item) => ({ ...item, size: sizeOf(item) })), source);
    for (const item of found) if (Object.hasOwn(sizes, item.productId)) cart.setSize(item.pieceId, sizeOf(item));
    cart.setOpen(true);
  }

  // Uncertain matches stay out of the cart until the shopper decides.
  function decide(index: number, use: boolean) {
    setSlots(current => current.map((slot, i) => i !== index || slot.state !== "approval" ? slot
      : use ? { state: "found", name: slot.name, item: slot.item, why: slot.why, proof: slot.proof } : { state: "missing", name: slot.name }));
  }

  function closeInspection() {
    setSelectedPieceId(null);
    inspectionTrigger.current?.focus();
  }

  function addSelected() {
    if (!selected || !cart.ready) return;
    if (replacesScreenshot) cart.clear();
    if (!inCart(selected) || replacesScreenshot) {
      cart.add({ ...selected, size: sizeOf(selected) }, source);
      if (Object.hasOwn(sizes, selected.productId)) cart.setSize(selected.pieceId, sizeOf(selected));
    }
    cart.setOpen(true);
  }

  const running = phase === "running";
  const allInCart = !replacesScreenshot && found.length > 0 && found.every((item) => inCart(item));
  const missing = visible.filter((slot) => slot.state === "missing").length;

  return <div className="page shot">
    <aside className="shot-input">
      <ClipInput disabled={running} onSubmit={(form, clipPreview) => runStream(form, clipPreview, "/api/clip-costume")} />
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
        {preview && segmentation && !restored && <SegmentationOverlay segmentation={segmentation} vision={vision} active={activePiece} />}
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
      {(saving || savePayload && !boardSynced && !saveError) && <p className="meta" role="status">Saving this board…</p>}
      {saveError && <p className="notice" role="alert">{saveError} {boardRequestId && <button type="button" className="text-btn" onClick={() => setSaveAttempt(value => value + 1)}>Try saving again</button>}</p>}
      {savedLook && boardSynced && <p className="shot-saved" role="status">Your products are saved. <a href={`/create/${savedLook.id}`}>Open saved look</a>. The source photo stays temporary.</p>}

      {segmentation && !restored && <PipelineStrip timings={segmentation.timings_ms} />}
      {(running || visible.length > 0) && <AssemblyStatus discovery found={discovered} total={visible.length} missing={missing} running={running} stopped={phase === "error"} />}
      {running && visible.length === 0 && <div className="shot-preparing" aria-hidden="true">
        <span className="shot-preparing-sheet" />
        <span className="shot-preparing-sheet" />
        <span className="shot-preparing-sheet" />
        <p>Making room for your look</p>
      </div>}
      {visible.length > 0 ? <div className={`shot-workbench ${selected ? "has-selection" : ""}`}>
        <ul className="shot-lay">
        {visible.map((slot, i) => <li key={i} className={`shot-slot is-${slot.state} ${slot.state === "found" && selected?.pieceId === slot.item.pieceId ? "is-selected" : ""}`} style={{ "--r": `${TILT[i % TILT.length]}deg` } as CSSProperties}
          onMouseEnter={() => setActivePiece(i)} onMouseLeave={() => setActivePiece(null)} onFocus={() => setActivePiece(i)} onBlur={() => setActivePiece(null)}>
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
          </a> : slot.state === "approval" ? <div className="shot-approval">
            <a className="shot-inspect" href={slot.item.productUrl} target="_blank" rel="noopener noreferrer">
              <span className="shot-frame"><MatchImage src={slot.item.image} title={slot.item.title} merchant={slot.item.merchantName} /></span>
              <span className="shot-caption"><span className="shot-piece">{slot.name}</span><span className="shot-title">{slot.item.title}</span>
                <span className="meta">{slot.item.merchantName} · {formatPrice(slot.item.priceCents)}</span></span>
            </a>
            <p className="shot-approval-note">{BECAUSE[slot.because] ?? "This match is uncertain."} Use it?</p>
            <div className="shot-approval-actions">
              <button type="button" className="btn" onClick={() => decide(i, true)}>Use this anyway</button>
              <button type="button" className="btn btn-ghost" onClick={() => decide(i, false)}>Skip piece</button>
            </div>
          </div> : <>
            <div className="shot-frame"><AssemblyPlaceholder state={slot.state === "looking" && phase === "error" ? "stopped" : slot.state} index={i} /></div>
            <div className="shot-caption"><p className="shot-piece">{slot.name}</p></div>
          </>}
          {savedLook && !running && (slot.state === "missing" || slot.state === "looking" || slot.state === "candidate") && <button type="button" className="text-btn shot-retry" disabled={retrying !== null || saving || !boardSynced} onClick={() => void retryPiece(i)}>{retrying === i ? "Searching this piece…" : "Search this piece again"}</button>}
          {!restored && <PieceVision vision={vision[i]} index={i} />}
          {!restored && <MatchTrace vision={vision[i]} trace={traces[i] ?? []} index={i} />}
        </li>)}
        </ul>
        {selected && <PieceInspectionPanel id="screenshot-piece-inspection" item={selected}
          size={sizeOf(selected)} inCart={inCart(selected) && !replacesScreenshot} addDisabled={!cart.ready}
          onSizeChange={(size) => chooseSize(selected, size)} onAdd={addSelected} onClose={closeInspection} />}
      </div> : !running && <div className="shot-empty" aria-hidden="true">{TILT.slice(0, 6).map((r, i) => <span key={i} style={{ "--r": `${r}deg` } as CSSProperties} />)}</div>}

      {discovered > 0 && <div className="shot-foot">
        <p className="meta">{replacesScreenshot ? "This replaces the previous screenshot look in your cart. " : ""}{discovered > found.length ? "Open shop links for items without confirmed prices. " : ""}{pending > 0 ? `${pending} ${pending === 1 ? "piece needs" : "pieces need"} your OK. ` : ""}{missing > 0 ? `${missing} ${missing === 1 ? "piece needs" : "pieces need"} another search. ` : ""}Prices and stock can change. Checkout checks cart items again.</p>
        {found.length > 0 && <button type="button" className="btn" disabled={!cart.ready} onClick={allInCart ? () => cart.setOpen(true) : addLook}>
          {allInCart ? "View cart" : `Add ${found.length < visible.length ? "priced pieces" : "the look"} to cart · ${formatPrice(total)}`}
        </button>}
      </div>}
      {savedLook && boardSynced && found.length > 0 && !saving && <details className="shot-personal-preview">
        <summary>See these pieces on you</summary>
        <p>Preview the exact saved products. Photos and previews stay temporary.</p>
        <PhoneCameraProvider><VirtualTryOn previewSource="screenshot" savedLookId={savedLook.id} name={savedLook.name} image={found[0]?.image} totalCents={total}
          selection={found.map(item => ({ pieceId: item.pieceId, productId: item.productId }))}
          pieces={found.map(item => ({ id: item.pieceId, name: item.pieceName }))} /></PhoneCameraProvider>
      </details>}
    </section>
  </div>;
}
