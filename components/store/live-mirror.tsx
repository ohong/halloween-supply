"use client";

/* Catalog cutouts and in-memory camera frames intentionally bypass image optimization. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Camera, ChevronLeft, ChevronRight, Download, Mic, MicOff, Pause, Play, Undo2, X } from "lucide-react";
import { formatPrice } from "@/lib/cart/context";
import type { CostumeView } from "@/lib/types";
import type { MirrorCatalogContext, MirrorCatalogLook, MirrorCatalogResults, MirrorCommand, MirrorOutfit, MirrorAction } from "@/lib/live-mirror/types";
import { costumes } from "@/lib/costumes";
import { applyActions, createOutfit, outfitTotal } from "@/lib/live-mirror/state";
import { sendMirrorCommand, useLiveVoice } from "@/lib/live-mirror/use-live-voice";
import { useLiveVideo } from "@/lib/live-mirror/use-live-video";
import { VoiceStateIndicator } from "./voice-state-indicator";
import { LiveTranscript, useLiveTranscript } from "./live-transcript";
import "./live-mirror.css";
import { PhoneCameraControls, usePhoneCamera } from "./phone-camera";

type Props = { costume: CostumeView; initialOutfit: MirrorOutfit; onApply: (outfit: MirrorOutfit, costume?: CostumeView) => void };
const copyOutfit = (outfit: MirrorOutfit): MirrorOutfit => ({ ...outfit, ...(outfit.appearance ? { appearance: Object.fromEntries(Object.entries(outfit.appearance).map(([id, value]) => [id, { ...value }])) } : {}), selection: { ...outfit.selection }, uses: { ...outfit.uses }, locked: [...outfit.locked], ...(outfit.mixes ? { mixes: outfit.mixes.map(ref => ({ ...ref })) } : {}) });

export function LiveMirror(props: Props) {
  const phone = usePhoneCamera();
  const [open, setOpen] = useState(false);
  const launchRef = useRef<HTMLButtonElement>(null);
  return <>
    <div className="mirror-launch">
      <button ref={launchRef} className="btn btn-ghost" onClick={() => { phone.setMode("live"); setOpen(true); }}><Camera size={17} aria-hidden="true" />Try it on live</button>
    </div>
    {open && createPortal(<MirrorRoom {...props} onClose={() => { phone.setMode("photo"); setOpen(false); requestAnimationFrame(() => launchRef.current?.focus()); }} />, document.body)}
  </>;
}

function MirrorRoom({ costume: initialCostume, initialOutfit, onApply, onClose }: Props & { onClose: () => void }) {
  const [costume, setCostume] = useState(initialCostume);
  const costumeRef = useRef(costume);
  const lookCache = useRef(new Map([[initialCostume.costume.slug, initialCostume]]));
  const lookRequest = useRef<AbortController | null>(null);
  const mixRequest = useRef<AbortController | null>(null);
  const [switchingLook, setSwitchingLook] = useState(false);
  const [catalogLooks, setCatalogLooks] = useState<MirrorCatalogLook[]>(() => costumes.map(look => ({ ...look, pieces: [] })));
  const [catalogResults, setCatalogResults] = useState<MirrorCatalogResults | null>(null);
  const catalogContext = useMemo<MirrorCatalogContext | undefined>(() => catalogResults ? {
    query: catalogResults.query,
    matches: catalogResults.matches.map(({ costumeSlug, pieceId, productId }) => ({ costumeSlug, pieceId, productId })),
  } : undefined, [catalogResults]);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const [outfit, setOutfit] = useState(() => createOutfit(costume, initialOutfit));
  const outfitRef = useRef(outfit);
  const applyRef = useRef(onApply);
  useEffect(() => { applyRef.current = onApply; }, [onApply]);
  const [history, setHistory] = useState<{ outfit: MirrorOutfit; costume: CostumeView }[]>([]);
  const historyRef = useRef<{ outfit: MirrorOutfit; costume: CostumeView }[]>([]);
  const [frozen, setFrozen] = useState<string | null>(null);
  const frozenRef = useRef<string | null>(null);
  const [focusedPiece, setFocusedPiece] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [commandText, setCommandText] = useState("");
  const [sending, setSending] = useState(false);
  const transcript = useLiveTranscript();
  const [availability, setAvailability] = useState<{ videoAvailable: boolean; voiceAvailable: boolean } | null>(null);
  const [configError, setConfigError] = useState("");
  const [consent, setConsent] = useState(false);
  const roomRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<HTMLVideoElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const revisionRef = useRef(0);
  const commandHandler = useRef<(command: MirrorCommand) => void | Promise<void>>(() => {});
  const phone = usePhoneCamera();
  const phoneStream = phone.status === "connected" ? phone.stream : null;
  const previousPhone = useRef<MediaStream | null>(phoneStream);
  const video = useLiveVideo({ costume, outfit }, phoneStream);
  const { start: startVideo, stop: stopVideo } = video;
  const voice = useLiveVoice({ costume, outfit, microphone: phoneStream, catalogContext, pendingLook: switchingLook, preview: { status: video.status, isCurrent: video.isCurrent, frozen: !!frozen, error: video.error }, onFocus: setFocusedPiece, onCommand: (command) => commandHandler.current(command), onTranscript: transcript.receive });
  const stopRef = useRef({ video: video.stop, voice: voice.stop });
  useEffect(() => {
    if (previousPhone.current !== phoneStream) {
      stopRef.current.video(); stopRef.current.voice();
      previousPhone.current = phoneStream;
    }
  }, [phoneStream]);
  useEffect(() => { stopRef.current = { video: video.stop, voice: voice.stop }; }, [video.stop, voice.stop]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/live-mirror/catalog", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("The costume list could not load.");
      const result = await response.json() as { looks: MirrorCatalogLook[] };
      if (!Array.isArray(result.looks) || !result.looks.length) throw new Error("The costume list is unavailable.");
      if (!controller.signal.aborted) setCatalogLooks(result.looks);
    }).catch(() => { if (!controller.signal.aborted) setNotice("The full costume list could not load. You can still search for a costume or piece."); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    // A swipe on the non-focusable preview can move keyboard focus to the body.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      stopRef.current.video();
      stopRef.current.voice();
      phone.disconnect();
      onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose, phone]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const controller = new AbortController();
    void fetch("/api/live-mirror/video", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Couldn't check camera and voice availability. Try again.");
      const result = await response.json();
      setAvailability({ videoAvailable: result.videoAvailable === true, voiceAvailable: result.voiceAvailable === true });
    }).catch((error: unknown) => { if (!controller.signal.aborted) setConfigError(error instanceof Error ? error.message : "Camera and voice are unavailable. Try again."); });
    return () => {
      controller.abort();
      requestRef.current?.abort();
      lookRequest.current?.abort();
      mixRequest.current?.abort();
      stopRef.current.video();
      stopRef.current.voice();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = video.stream;
  }, [video.stream, frozen]);

  useEffect(() => { if (cameraRef.current) cameraRef.current.srcObject = video.cameraStream; }, [video.cameraStream]);

  const remember = useCallback((next: MirrorOutfit, nextCostume = costumeRef.current) => {
    if (nextCostume.costume.slug === costumeRef.current.costume.slug && JSON.stringify(next) === JSON.stringify(outfitRef.current)) return;
    historyRef.current = [...historyRef.current, { outfit: copyOutfit(outfitRef.current), costume: costumeRef.current }].slice(-30);
    setHistory(historyRef.current);
    costumeRef.current = nextCostume;
    setCostume(nextCostume);
    outfitRef.current = copyOutfit(next);
    revisionRef.current += 1;
    setOutfit(outfitRef.current);
    if (costumeRef.current.costume.slug === initialCostume.costume.slug) applyRef.current(copyOutfit(outfitRef.current), costumeRef.current);
  }, [initialCostume.costume.slug]);

  const undo = useCallback(() => {
    const previous = historyRef.current.at(-1);
    if (!previous) { setNotice("You're back at your first look."); return; }
    historyRef.current = historyRef.current.slice(0, -1);
    setHistory(historyRef.current);
    costumeRef.current = previous.costume;
    setCostume(previous.costume);
    outfitRef.current = copyOutfit(previous.outfit);
    revisionRef.current += 1;
    setOutfit(outfitRef.current);
    if (costumeRef.current.costume.slug === initialCostume.costume.slug) applyRef.current(copyOutfit(outfitRef.current), costumeRef.current);
    setNotice("Previous look restored.");
  }, [initialCostume.costume.slug]);

  const capture = useCallback(() => {
    const element = videoRef.current;
    if (!element?.videoWidth || !element.videoHeight) return null;
    const canvas = document.createElement("canvas");
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;
    try { context.drawImage(element, 0, 0); return canvas.toDataURL("image/jpeg", 0.85); } catch { return null; }
  }, []);

  const saveLook = useCallback(() => {
    const image = frozenRef.current ?? capture();
    if (!image) { setNotice("Start a preview before saving."); return; }
    const link = document.createElement("a");
    link.href = image;
    link.download = `${costume.costume.slug}-mirror.jpg`;
    link.click();
    setNotice("Preview downloaded.");
  }, [capture, costume.costume.slug]);

  const freeze = useCallback(() => {
    if (!video.isCurrent) { setNotice("Wait for the latest outfit to finish updating before freezing your preview."); return; }
    const frame = capture();
    if (!frame) { setNotice("Start your camera preview before freezing a look."); return; }
    frozenRef.current = frame;
    setFrozen(frame);
    stopVideo();
    setNotice(phoneStream ? "Preview frozen. Live processing stopped; your phone preview stays connected." : "Preview frozen. Camera is off; you can keep editing your pieces.");
  }, [capture, stopVideo, video.isCurrent, phoneStream]);

  const resume = useCallback(() => {
    if (!consent || !availability?.videoAvailable) { setNotice("Allow camera processing and start your preview first."); return; }
    frozenRef.current = null;
    setFrozen(null);
    setNotice("");
    void startVideo();
  }, [consent, availability?.videoAvailable, startVideo]);

  const switchLook = useCallback(async (slug: string, selection?: Record<string, string>) => {
    if (!slug) return;
    lookRequest.current?.abort();
    mixRequest.current?.abort();
    const controller = new AbortController();
    lookRequest.current = controller;
    requestRef.current?.abort();
    setSending(false);
    revisionRef.current++;
    setSwitchingLook(true);
    try {
      let next = selection ? undefined : lookCache.current.get(slug);
      if (!next) {
        const response = await fetch(`/api/live-mirror/catalog?slug=${encodeURIComponent(slug)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("This costume could not load. Please try again.");
        next = await response.json() as CostumeView;
        if (next.costume.slug !== slug || !next.pieces.length) throw new Error("This costume is unavailable.");
        lookCache.current.set(slug, next);
      }
      if (controller.signal.aborted) return;
      if (selection && Object.entries(selection).some(([pieceId, productId]) => !next.pieces.some(view => view.piece.id === pieceId && view.options.some(option => option.product.id === productId && option.product.availability !== "out_of_stock")))) {
        throw new Error("That search result changed. Search for the item again.");
      }
      const base: Partial<MirrorOutfit> = slug === costumeRef.current.costume.slug ? outfitRef.current : slug === initialCostume.costume.slug ? initialOutfit : {};
      const nextOutfit = createOutfit(next, { ...base, budget: outfitRef.current.budget, selection: { ...base.selection, ...selection } });
      historyRef.current = [...historyRef.current, { outfit: copyOutfit(outfitRef.current), costume: costumeRef.current }].slice(-30);
      setHistory(historyRef.current);
      costumeRef.current = next;
      outfitRef.current = nextOutfit;
      setCostume(next);
      setOutfit(nextOutfit);
      if (slug === initialCostume.costume.slug) applyRef.current(copyOutfit(nextOutfit), next);
      setCatalogLooks(previous => previous.some(look => look.slug === next.costume.slug) ? previous : [...previous, { ...next.costume, pieces: next.pieces.map(({ piece }) => ({ id: piece.id, name: piece.name, category: piece.category })) }]);
      setFocusedPiece(null);
      setNotice(`Trying ${next.costume.name}.`);
    } catch (error) {
      if (!controller.signal.aborted) { setNotice(error instanceof Error ? error.message : "This costume could not load."); throw error; }
    } finally {
      if (lookRequest.current === controller) { lookRequest.current = null; setSwitchingLook(false); }
    }
  }, [initialCostume.costume.slug, initialOutfit]);

  const cycleLook = (direction: number) => {
    const index = catalogLooks.findIndex(look => look.slug === costume.costume.slug);
    void switchLook(catalogLooks[(index + direction + catalogLooks.length) % catalogLooks.length].slug).catch(() => {});
  };
  const nextLook = catalogLooks[(catalogLooks.findIndex(look => look.slug === costume.costume.slug) + 1) % catalogLooks.length];

  const handleCommand = useCallback(async (command: MirrorCommand) => {
    if (command.catalogResults) {
      setCatalogResults(command.catalogResults);
      revisionRef.current++;
      setNotice("");
    }
    const newLook = command.actions.find(action => action.type === "try_look");
    if (newLook?.type === "try_look") { await switchLook(newLook.costumeSlug, newLook.selection); return; }
    if (lookRequest.current) return;
    if (command.message && !command.catalogResults) setNotice(command.message);
    const mixes = command.actions.filter((action): action is Extract<MirrorAction, { type: "mix" }> => action.type === "mix");
    let editingCostume = costumeRef.current;
    let editingOutfit = outfitRef.current;
    if (mixes.length) {
      const revision = revisionRef.current;
      mixRequest.current?.abort();
      const controller = new AbortController();
      mixRequest.current = controller;
      const response = await fetch("/api/live-mirror/mix", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costumeSlug: editingCostume.costume.slug, outfit: editingOutfit, actions: mixes }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "That piece could not be added.");
      if (controller.signal.aborted || !roomRef.current || revision !== revisionRef.current) throw new Error("Your outfit changed. Please try adding that piece again.");
      editingCostume = result.costume as CostumeView;
      editingOutfit = result.outfit as MirrorOutfit;
    }
    const edits = command.actions.filter((action) => !["mix", "undo", "save", "freeze", "resume"].includes(action.type));
    if (edits.length || mixes.length) {
      const result = applyActions(editingCostume, editingOutfit, edits);
      remember(result.outfit, editingCostume);
      setNotice(result.message ?? (mixes.length ? "Outfit updated." : ""));
    }
    for (const action of command.actions) {
      if (action.type === "undo") undo();
      if (action.type === "save") saveLook();
      if (action.type === "freeze") freeze();
      if (action.type === "resume") resume();
    }
  }, [remember, undo, saveLook, freeze, resume, switchLook]);
  useEffect(() => { commandHandler.current = handleCommand; }, [handleCommand]);

  function returnToPhoto() { video.stop(); voice.stop(); onClose(); }
  function close() { phone.disconnect(); returnToPhoto(); }
  async function submitCommand(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = commandText.trim();
    if (!text || sending) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const revision = revisionRef.current;
    setSending(true);
    transcript.append(text, "user");
    setCommandText("");
    try {
      const command = await sendMirrorCommand({ costumeSlug: costume.costume.slug, outfit: outfitRef.current, text, catalogContext }, controller.signal);
      if (controller.signal.aborted) return;
      if (revision !== revisionRef.current) { setNotice("Your look changed while that request was running. Please try it again."); return; }
      await handleCommand(command);
      if (command.message) transcript.append(command.message, "assistant");
    } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "That request didn't go through. Try again."); }
    finally { if (!controller.signal.aborted) setSending(false); }
  }

  async function addSearchProduct(match: NonNullable<MirrorCatalogResults>["matches"][number]) {
    if (sending || switchingLook) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const revision = revisionRef.current;
    setSending(true);
    try {
      const command = await sendMirrorCommand({ costumeSlug: costumeRef.current.costume.slug, outfit: outfitRef.current,
        text: "Add this product to my current outfit. Replace the existing piece with the same function, if any, and keep everything else.",
        catalogOnly: true, catalogContext: { query: "The shopper clicked Add to outfit for this specific product.", matches: [{ costumeSlug: match.costumeSlug, pieceId: match.pieceId, productId: match.productId }] } }, controller.signal);
      if (controller.signal.aborted || revision !== revisionRef.current) return;
      await handleCommand(command);
      if (command.message) transcript.append(command.message, "assistant");
    } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "That piece could not be added."); }
    finally { if (!controller.signal.aborted) setSending(false); }
  }

  function trapFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const elements = [...(roomRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])].filter((element) => element.getClientRects().length > 0);
    const first = elements[0];
    const last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  const shopQuery = new URLSearchParams({
    look: Object.values(outfit.selection).join(","),
    ...(outfit.mixes?.length ? { mix: JSON.stringify(outfit.mixes) } : {}),
    owned: Object.entries(outfit.uses).filter(([, use]) => use === "owned").map(([id]) => id).join(","),
    skipped: Object.entries(outfit.uses).filter(([, use]) => use === "skip").map(([id]) => id).join(","),
  });
  const live = video.status === "live";
  const connecting = video.status === "connecting" || voice.status === "connecting";
  const canStart = consent && !["waiting", "connecting"].includes(phone.status) && availability && (availability.videoAvailable || availability.voiceAvailable);
  const startSession = () => {
    if (!canStart) return;
    if (availability.videoAvailable && !live) { frozenRef.current = null; setFrozen(null); void video.start(); }
    if (availability.voiceAvailable && voice.status !== "live") void voice.start();
  };

  return <div className="mirror-room" ref={roomRef} role="dialog" aria-modal="true" aria-labelledby="mirror-room-title" onKeyDown={trapFocus}>
    <header className="mirror-header">
      <div><h2 id="mirror-room-title">Costume Mirror<span>{costume.costume.name}</span></h2></div>
      <div className="mirror-header-actions"><button className="mirror-link" onClick={returnToPhoto}>Use photo mode</button><button ref={closeRef} className="mirror-icon-button" onClick={close} aria-label="Close costume mirror"><X size={22} /></button></div>
    </header>
    <div className="mirror-body">
      <section className="mirror-visual" aria-label="Costume preview">
        <div className={`mirror-stage${!video.stream && !frozen ? " is-idle" : ""}`} onPointerDown={event => {
          if ((event.target as HTMLElement).closest("button")) return;
          swipeStart.current = { x: event.clientX, y: event.clientY };
        }} onPointerUp={event => {
          const start = swipeStart.current;
          swipeStart.current = null;
          if (start && Math.abs(event.clientY - start.y) > 70 && Math.abs(event.clientX - start.x) < 90) cycleLook(event.clientY < start.y ? 1 : -1);
        }} onPointerCancel={() => { swipeStart.current = null; }}>
          {frozen ? <img className="mirror-camera" src={frozen} alt="Your frozen costume preview" /> : <video ref={videoRef} className={`mirror-camera${video.stream ? "" : " mirror-hidden"}`} autoPlay playsInline muted onPlaying={video.onFrame} aria-label="Live costume preview" />}
          {!video.stream && !frozen && <div className="mirror-stage-intro">
            <img className="mirror-idle-look" src={costume.costume.image} alt={costume.costume.name} />
            <div className="mirror-stage-welcome"><h3>Your costume, live.</h3><p>Start the mirror. Say what you want to change.</p></div>
          {!video.stream && !frozen && <div className="mirror-start">
            {availability && !availability.videoAvailable && <p className="mirror-notice">Live camera try-on isn’t available right now. {availability.voiceAvailable ? "You can still change your look by voice, or " : "You can "} <button className="mirror-link" onClick={() => { returnToPhoto(); requestAnimationFrame(() => document.querySelector(".try-on")?.scrollIntoView({ behavior: "smooth", block: "start" })); }}>use photo try-on</button>.</p>}
            {configError && <p className="mirror-notice">{configError}</p>}
            {availability && (availability.videoAvailable || availability.voiceAvailable) && <>
              <PhoneCameraControls compact /><p className="mirror-muted">{phoneStream ? `Using your phone camera. ${phoneStream.getAudioTracks().length ? "Voice uses your phone microphone." : "Voice uses this computer’s microphone."}` : "Use this device’s camera, or connect your phone above."}</p>
              <label className="mirror-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>{availability.videoAvailable ? "Allow my camera video to be processed by Decart, connected through fal, for live try-on. " : ""}{availability.voiceAvailable ? "Allow my microphone audio to be processed by OpenAI for voice controls. " : ""}Media stops when I close the mirror.</span></label>
              <button className="btn" disabled={!canStart || connecting} onClick={startSession}><Camera size={17} />{connecting ? "Connecting…" : availability.videoAvailable ? "Start my mirror" : "Start voice styling"}</button>
            </>}
            {!availability && !configError && <p className="mirror-muted">Checking camera and voice availability…</p>}
          </div>}
          </div>}
          {video.cameraStream && <video ref={cameraRef} className="mirror-original" autoPlay playsInline muted aria-label="Original camera" />}
          <div className="mirror-stage-label" role="status"><span className={live ? "mirror-dot is-live" : "mirror-dot"} />{frozen ? (phoneStream ? "Frozen preview · phone connected" : "Frozen preview · camera off") : live ? "Live preview" : connecting ? video.stream ? "Updating your look…" : "Connecting…" : "Your preview"}</div>
          {video.stream && !frozen && <button className="mirror-next-look" onClick={() => cycleLook(1)} disabled={switchingLook} aria-label={`Switch to ${nextLook.name}`}><img src={nextLook.image} alt="" /><span>{switchingLook ? "Loading…" : "Swipe up to switch"}</span></button>}
          {(video.stream || frozen) && <button className="mirror-freeze" disabled={!frozen && !video.isCurrent} onClick={frozen ? resume : freeze}>{frozen ? <Play size={15} /> : <Pause size={15} />}{frozen ? "Resume camera" : "Freeze look"}</button>}
        </div>
        <nav className="mirror-look-switch" aria-label="Switch costume">
          <button className="mirror-icon-button" onClick={() => cycleLook(-1)} disabled={switchingLook} aria-label="Previous costume"><ChevronLeft size={20} /></button>
          <div className="mirror-current-look" aria-live="polite"><span>{costume.costume.name}</span><p>{switchingLook ? "Loading costume…" : 'Say “Change my costume” to try another look.'}</p></div>
          <button className="mirror-icon-button" onClick={() => cycleLook(1)} disabled={switchingLook} aria-label="Next costume"><ChevronRight size={20} /></button>
        </nav>
        <div className="mirror-below-stage">
          <p>Stand back so your outfit is visible. Preview changes can take a moment. Fit and product details may vary.</p>
          {frozen && <p>The frozen image stays unchanged as you edit. Resume to preview your latest pieces.</p>}

          {(video.error || voice.error) && <p className="mirror-error" role="alert">{video.error || voice.error}</p>}
        </div>
      </section>
      <section className="mirror-workbench" aria-label="Build your costume">
        <div className="mirror-workbench-heading"><h3>GPT Live</h3><button className="mirror-icon-button" disabled={!history.length} onClick={undo} aria-label="Undo last outfit change"><Undo2 size={19} /></button></div>
        <p className="mirror-voice-hint">A new costume. A different piece. Any color.<br />Just ask.</p>
        <div className="mirror-voice-box">
          {availability?.voiceAvailable && <VoiceStateIndicator status={voice.status} activity={voice.activity} muted={voice.muted} onStop={voice.stop} />}
          <LiveTranscript entries={transcript.entries} latestId={transcript.latestId} />
          <form onSubmit={submitCommand} className="mirror-command-form">
            <label className="mirror-sr-only" htmlFor="mirror-command">Tell us how to change your look</label>
            <input id="mirror-command" value={commandText} onChange={(event) => setCommandText(event.target.value)} placeholder="Or type a change…" maxLength={1000} />
            <button type="submit" className="mirror-icon-button" disabled={sending || !commandText.trim()} aria-label={sending ? "Applying your request" : "Send styling request"}><ArrowRight size={19} /></button>
            {availability?.voiceAvailable && <button type="button" className={`mirror-icon-button${voice.status === "live" && !voice.muted ? " mirror-mic-on" : ""}`} disabled={!consent || voice.status === "connecting"} onClick={() => voice.status === "live" ? voice.toggleMute() : void voice.start()} aria-label={voice.status === "live" ? voice.muted ? "Unmute microphone" : "Mute microphone" : "Start voice styling"}>{voice.status === "live" && voice.muted ? <MicOff size={19} /> : <Mic size={19} />}</button>}
          </form>
          {sending && <p className="mirror-muted" role="status">Considering your change…</p>}

        </div>
        {catalogResults && <section className="mirror-catalog-results" aria-label="Catalog search results" aria-live="polite">
          {catalogResults.matches.length > 0 && <ul>{catalogResults.matches.map(match => <li key={`${match.costumeSlug}:${match.pieceId}:${match.productId}`}>
            <img src={match.option.product.merchantImage ?? match.option.product.image} alt={match.option.product.title} loading="lazy" />
            <div><p className="mirror-muted">{match.costumeName} · {match.pieceName}</p>
              <a href={match.option.product.url} target="_blank" rel="noopener noreferrer">{match.option.product.title}</a>
              <p>{formatPrice(match.option.product.priceCents)} · {match.option.merchant.name}{match.option.product.availability === "out_of_stock" ? " · Out of stock" : match.option.product.availability === "unknown" ? " · Stock unconfirmed" : ""}</p>
              <button type="button" className="mirror-link" disabled={sending || switchingLook || match.option.product.availability === "out_of_stock"} onClick={() => void addSearchProduct(match)} aria-label={`Add ${match.option.product.title} to current outfit`}>Add to outfit<ArrowRight size={13} aria-hidden="true" /></button>
            </div>
          </li>)}</ul>}
        </section>}
        <div className="mirror-preview-edits" aria-live="polite">{Object.keys(outfit.appearance ?? {}).length > 0 && <><p>Preview edits</p><ul>{Object.entries(outfit.appearance ?? {}).map(([id, edit]) => <li key={id}><span>{costume.pieces.find(({ piece }) => piece.id === id)?.piece.name}</span><span>{[edit.color, edit.style].filter(Boolean).join(" · ")}</span></li>)}</ul><small>Visual changes apply to this preview. Shop items keep their listed colors and styles.</small></>}</div>
        <details className="mirror-details"><summary>Costumes &amp; pieces</summary>
        <label className="mirror-catalog-label" htmlFor="mirror-look">Costume</label><select id="mirror-look" value={costume.costume.slug} disabled={switchingLook} onChange={event => void switchLook(event.target.value).catch(() => {})}>{catalogLooks.map(look => <option key={look.slug} value={look.slug}>{look.name}</option>)}</select>
        <div className="mirror-pieces" aria-label="Selected costume pieces">
          {costume.pieces.map(({ piece, options }) => {
            const selectedOption = options.find(option => option.product.id === outfit.selection[piece.id]);
            const product = selectedOption?.product;
            if (!product) return null;
            return <div className={`mirror-piece${focusedPiece === piece.id ? " is-focused" : ""}`} key={piece.id}>
              <img src={product.cutout ?? product.image} alt={product.title} />
              <div><label htmlFor={`mirror-piece-${piece.id}`}>{piece.name}</label>
                <select id={`mirror-piece-${piece.id}`} value={product.id} disabled={outfit.locked.includes(piece.id)} onChange={event => handleCommand({ actions: [{ type: "select", pieceId: piece.id, productId: event.target.value }] })}>
                  {options.map(({ product: option }) => <option key={option.id} value={option.id} disabled={option.availability === "out_of_stock"}>{option.title} · {formatPrice(option.priceCents)}</option>)}
                </select>
                <p>{outfit.uses[piece.id] === "owned" ? "Already owned" : outfit.uses[piece.id] === "skip" ? "Not included" : formatPrice(product.priceCents)}{outfit.locked.includes(piece.id) ? " · Kept" : ""} · {selectedOption?.merchant.name}</p>
              </div>
            </div>;
          })}
        </div>
        </details>
        <a className="btn mirror-shop" href={`/costumes/${costume.costume.slug}?${shopQuery}`} onClick={event => {
          if (costume.costume.slug === initialCostume.costume.slug) { event.preventDefault(); requestAnimationFrame(() => document.getElementById("selected-outfit")?.scrollIntoView({ behavior: "smooth" })); }
          close();
        }}>Shop this look · {formatPrice(outfitTotal(costume, outfit))}<ArrowRight size={16} /></a>
        <button className="mirror-link" disabled={!frozen && !video.isCurrent} onClick={saveLook}><Download size={16} />Save this preview</button>
        {notice && <p className="mirror-feedback" role="status" aria-live="polite">{notice}</p>}
      </section>
    </div>
  </div>;
}
