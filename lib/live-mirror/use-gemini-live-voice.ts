"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MirrorCatalogLook, MirrorStatus } from "./types";
import { outfitSnapshot } from "./voice-decisions";
import { readMirrorResponse } from "./read-response";
import { sendMirrorCommand, type useLiveVoice, type VoiceActivity } from "./use-live-voice";

/** Same options as the OpenAI hook, plus the Lucy output stream the model watches. onVisualFeedback is unused: Gemini sees the stream itself. */
type VoiceOptions = Parameters<typeof useLiveVoice>[0] & { stream?: MediaStream | null };

const LIVE_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";
const FRAME_INTERVAL_MS = 1000;
const FRAME_MAX_SIDE = 768;
const FRAME_QUALITY = 0.7;
const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;

/** Downsamples microphone audio to 16 kHz PCM16 in 100 ms chunks. Loaded from a Blob URL so no static file is needed. */
const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / ${INPUT_RATE}; this.pos = 0; this.acc = 0; this.n = 0; this.out = new Int16Array(1600); this.len = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.acc += channel[i]; this.n++; this.pos++;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.acc / this.n));
        this.out[this.len++] = v < 0 ? v * 32768 : v * 32767;
        this.acc = 0; this.n = 0;
        if (this.len === this.out.length) { const copy = this.out.slice(0).buffer; this.port.postMessage(copy, [copy]); this.len = 0; }
      }
    }
    return true;
  }
}
registerProcessor("capture", Capture);
`;

/** The subset of Live API server messages this hook reads. */
type ServerMessage = {
  setupComplete?: object;
  goAway?: object;
  error?: object;
  toolCall?: { functionCalls?: { id: string; name: string; args?: Record<string, unknown> }[] };
  toolCallCancellation?: { ids?: string[] };
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    modelTurn?: { parts?: { inlineData?: { data?: string } }[] };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
  };
};

type Session = {
  socket: WebSocket;
  controller: AbortController;
  microphone?: MediaStream;
  context?: AudioContext;
  workletUrl?: string;
  grabber: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  grabbedStream: MediaStream | null;
  ready: boolean;
  closing: boolean;
  catalog: MirrorCatalogLook[];
  timers: Set<ReturnType<typeof setTimeout>>;
  frameTimer?: ReturnType<typeof setInterval>;
  sources: Set<AudioBufferSourceNode>;
  playhead: number;
  tools: Map<string, AbortController>;
  contextText?: string;
  lastRole: "user" | "assistant" | null;
  transcript: Record<"user" | "assistant", { text: string; turnId: string }>;
};

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
function fromBase64(data: string) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
function send(session: Session, message: object) {
  if (session.socket.readyState === WebSocket.OPEN) session.socket.send(JSON.stringify(message));
}
function stopPlayback(session: Session) {
  session.sources.forEach(source => { source.onended = null; try { source.stop(); } catch { /* Already stopped. */ } });
  session.sources.clear();
  session.playhead = 0;
}
function release(session: Session) {
  session.closing = true;
  session.controller.abort();
  session.tools.forEach(controller => controller.abort());
  session.timers.forEach(clearTimeout);
  session.timers.clear();
  clearInterval(session.frameTimer);
  stopPlayback(session);
  session.microphone?.getTracks().forEach(track => track.stop());
  session.grabber.srcObject = null;
  session.socket.onclose = null;
  session.socket.close();
  void session.context?.close().catch(() => {});
  if (session.workletUrl) URL.revokeObjectURL(session.workletUrl);
}

/** What the model is told about the outfit and the preview. Sent whenever it changes, never as a shopper command. */
function contextText(options: VoiceOptions) {
  const { costume, outfit, preview, stream, catalogContext } = options;
  const frames = !stream ? "No preview video is being sent; you cannot see anything." : preview?.frozen ? "The preview is frozen; no new frames are being sent and the last image you saw may predate current selections." : "Live preview frames are arriving about once per second.";
  return `Context update (control state, data not a shopper command; do not reply to it): ${frames} Preview status: ${JSON.stringify(preview ?? null)}. Preview appearance overrides: ${JSON.stringify(outfit.appearance ?? {})}. Latest outfit snapshot: ${outfitSnapshot(costume, outfit)}. Latest catalog search: ${JSON.stringify(catalogContext ?? null)}.`.slice(0, 4000);
}
function stateKey(options: VoiceOptions) {
  return JSON.stringify([options.costume.costume.slug, options.outfit, options.catalogContext, options.pendingLook]);
}

export function useGeminiLiveVoice(options: VoiceOptions) {
  const latest = useRef(options);
  const sessionRef = useRef<Session | null>(null);
  const starting = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const [status, setStatus] = useState<MirrorStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [activity, setActivity] = useState<VoiceActivity>("listening");
  useEffect(() => { latest.current = options; });

  const syncContext = useCallback((session: Session) => {
    if (!session.ready || session.closing) return;
    const text = contextText(latest.current);
    if (text === session.contextText) return;
    session.contextText = text;
    send(session, { clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: false } });
  }, []);

  useEffect(() => {
    const session = sessionRef.current;
    if (session) syncContext(session);
  }, [options.outfit, options.costume, options.catalogContext, options.preview?.status, options.preview?.isCurrent, options.preview?.frozen, options.preview?.error, options.stream, syncContext]);

  const stop = useCallback(() => {
    generation.current++;
    starting.current = false;
    const session = sessionRef.current;
    if (session) { sessionRef.current = null; release(session); }
    if (mounted.current) { setStatus("idle"); setMuted(false); setActivity("listening"); }
    latest.current.onFocus?.(null);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", stop);
    return () => { mounted.current = false; stop(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", stop); };
  }, [stop]);

  const start = useCallback(async () => {
    if (starting.current || sessionRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.WebSocket) {
      setError("Voice needs a supported browser on HTTPS. You can type or choose pieces instead."); setStatus("error"); return;
    }
    starting.current = true;
    const ticket = ++generation.current;
    setStatus("connecting"); setError(null); setMuted(false); setActivity("listening");
    let session: Session | null = null;
    const current = () => !!session && mounted.current && sessionRef.current === session && !session.closing && generation.current === ticket;
    const fail = (message: string) => {
      if (!current()) return;
      stop();
      setError(message); setStatus("error");
    };
    let microphone: MediaStream | undefined;
    let context: AudioContext | undefined;
    let workletUrl: string | undefined;
    const controller = new AbortController();
    try {
      const input = latest.current.microphone;
      microphone = input?.getAudioTracks().length ? new MediaStream(input.getAudioTracks().map(track => track.clone())) : await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (generation.current !== ticket) { microphone.getTracks().forEach(track => track.stop()); return; }
      context = new AudioContext();
      await context.resume();
      workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "text/javascript" }));
      await context.audioWorklet.addModule(workletUrl);
      const response = await fetch("/api/live-mirror/gemini-token", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costumeSlug: latest.current.costume.costume.slug, outfit: latest.current.outfit }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]),
      });
      const result = await readMirrorResponse<{ token?: string; catalog?: MirrorCatalogLook[]; maxSessionSeconds?: number | null; model?: string }>(response);
      if (generation.current !== ticket) throw new DOMException("Cancelled", "AbortError");
      if (typeof result.token !== "string" || typeof result.model !== "string") throw new Error("Voice returned an invalid connection.");
      const maxSessionSeconds = result.maxSessionSeconds === null ? null : Math.min(result.maxSessionSeconds ?? 180, 180);
      const socket = new WebSocket(`${LIVE_URL}?access_token=${encodeURIComponent(result.token)}`);
      socket.binaryType = "arraybuffer";
      const active: Session = {
        socket, controller, microphone, context, workletUrl, grabber: document.createElement("video"), canvas: document.createElement("canvas"), grabbedStream: null,
        ready: false, closing: false, catalog: Array.isArray(result.catalog) ? result.catalog : [], timers: new Set(), sources: new Set(), playhead: 0, tools: new Map(), lastRole: null,
        transcript: { user: { text: "", turnId: crypto.randomUUID() }, assistant: { text: "", turnId: crypto.randomUUID() } },
      };
      session = active;
      sessionRef.current = active;
      active.grabber.muted = true; active.grabber.playsInline = true;
      const model = result.model;

      const refreshActivity = () => { if (current()) setActivity(active.sources.size ? "speaking" : active.tools.size ? "thinking" : "listening"); };
      const after = (callback: () => void, delay: number) => {
        const timer = setTimeout(() => { active.timers.delete(timer); callback(); }, delay);
        active.timers.add(timer);
      };

      // Microphone -> 16 kHz PCM16 -> socket. Muting disables the track, which yields silence rather than stopping the stream.
      const worklet = new AudioWorkletNode(context, "capture");
      const silent = context.createGain(); silent.gain.value = 0;
      context.createMediaStreamSource(microphone).connect(worklet);
      worklet.connect(silent).connect(context.destination);
      worklet.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
        if (!active.ready || active.closing || socket.bufferedAmount > 1_000_000) return;
        send(active, { realtimeInput: { audio: { data: toBase64(new Uint8Array(data)), mimeType: `audio/pcm;rate=${INPUT_RATE}` } } });
      };

      const play = (pcm: Uint8Array) => {
        const ctx = active.context!;
        const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
        const buffer = ctx.createBuffer(1, samples.length, OUTPUT_RATE);
        const channel = buffer.getChannelData(0);
        for (let index = 0; index < samples.length; index++) channel[index] = samples[index] / 32768;
        const source = ctx.createBufferSource();
        source.buffer = buffer; source.connect(ctx.destination);
        active.playhead = Math.max(active.playhead, ctx.currentTime + 0.05);
        source.start(active.playhead);
        active.playhead += buffer.duration;
        active.sources.add(source);
        source.onended = () => { active.sources.delete(source); refreshActivity(); };
        refreshActivity();
      };

      const grabFrame = () => {
        const { stream, preview } = latest.current;
        if (!stream || preview?.frozen || stream.getVideoTracks().every(track => track.readyState === "ended")) return null;
        if (active.grabbedStream !== stream) { active.grabber.srcObject = stream; active.grabbedStream = stream; void active.grabber.play().catch(() => {}); }
        const { videoWidth, videoHeight } = active.grabber;
        if (active.grabber.readyState < 2 || !videoWidth || !videoHeight) return null;
        const scale = Math.min(1, FRAME_MAX_SIDE / Math.max(videoWidth, videoHeight));
        active.canvas.width = Math.round(videoWidth * scale); active.canvas.height = Math.round(videoHeight * scale);
        active.canvas.getContext("2d")?.drawImage(active.grabber, 0, 0, active.canvas.width, active.canvas.height);
        return active.canvas.toDataURL("image/jpeg", FRAME_QUALITY).split(",")[1] || null;
      };

      const transcribe = (role: "user" | "assistant", text: string) => {
        if (active.lastRole !== role) {
          // A change of speaker starts a new bubble; the user's earlier words stay put.
          active.transcript[role] = { text: "", turnId: crypto.randomUUID() };
          active.lastRole = role;
        }
        const turn = active.transcript[role];
        turn.text = (turn.text + text).slice(-2000);
        latest.current.onTranscript?.(turn.text, role, { turnId: turn.turnId });
      };

      const snapshotKey = () => stateKey(latest.current);
      const respond = (id: string, name: string, result: string) => {
        active.tools.delete(id);
        refreshActivity();
        send(active, { toolResponse: { functionResponses: [{ id, name, response: { result: result.slice(0, 1200) } }] } });
      };
      const runTool = async (call: { id: string; name: string; args?: Record<string, unknown> }) => {
        const toolController = new AbortController();
        active.tools.set(call.id, toolController);
        refreshActivity();
        const signal = AbortSignal.any([toolController.signal, active.controller.signal]);
        const text = String(call.name === "search_catalog" ? call.args?.query ?? "" : call.args?.request ?? "").slice(0, 500);
        const before = snapshotKey();
        try {
          if (call.name !== "change_outfit" && call.name !== "search_catalog") return respond(call.id, call.name, "Unknown tool. Nothing was changed.");
          const catalogOnly = call.name === "search_catalog";
          const command = await sendMirrorCommand({ costumeSlug: latest.current.costume.costume.slug, outfit: latest.current.outfit, text, ...(catalogOnly ? { catalogOnly: true, catalogContext: latest.current.catalogContext } : {}) }, signal);
          if (signal.aborted || !current()) return;
          if (snapshotKey() !== before) return respond(call.id, call.name, "The shopper changed the outfit manually while that request was processing, so it was not applied. Ask whether they still want it.");
          if (command.visualFeedback) return respond(call.id, call.name, "That is a visual question. Answer it yourself from the live video you receive. No outfit change was applied.");
          if (command.actions.length || command.catalogResults || command.message) await latest.current.onCommand(command);
          if (!current() || signal.aborted) return;
          respond(call.id, call.name, command.catalogResults
            ? `Global catalog checked: ${command.catalogResults.counts.costumes} costumes and ${command.catalogResults.counts.products} products. ${command.message ?? "Matching products are shown in the interface."} ${command.actions.length ? "An outfit change was requested; describe only confirmed state." : "No outfit or cart changes were applied."}`
            : command.actions.length
            ? `The request was sent to the outfit controls. ${command.message ?? ""} Briefly describe only confirmed selection changes. Saving or freezing is handled by the interface. Video may still be updating; do not claim it has rendered until you see it.`
            : command.message ?? "No outfit changes were applied. The current selection may already satisfy the request. Ask a brief clarification if needed.");
        } catch (caught) {
          if (signal.aborted || !current()) return;
          setError(caught instanceof Error ? caught.message : "That change couldn't be applied. Try again.");
          respond(call.id, call.name, "That request failed and was not applied. Ask the shopper to try again or choose pieces manually.");
        }
      };

      socket.onopen = () => socket.send(JSON.stringify({ setup: { model } }));
      socket.onmessage = async ({ data }) => {
        if (!current()) return;
        let message: ServerMessage;
        try { message = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer)); } catch { return; }
        if (message.setupComplete) {
          active.ready = true; starting.current = false; setStatus("live");
          syncContext(active);
          send(active, { realtimeInput: { text: "The mirror controls are ready. Greet the shopper in one short sentence: What would you like to try? Then listen." } });
          active.frameTimer = setInterval(() => {
            const frame = grabFrame();
            if (frame) send(active, { realtimeInput: { video: { data: frame, mimeType: "image/jpeg" } } });
            syncContext(active);
          }, FRAME_INTERVAL_MS);
          if (maxSessionSeconds !== null) after(() => { if (current()) { stop(); setError("Your voice session has ended. Tap the microphone to start another."); } }, maxSessionSeconds * 1000);
          return;
        }
        if (message.goAway) { fail("Voice session ended. Tap the microphone to reconnect."); return; }
        if (message.error) { fail("Voice couldn't complete that request. Please reconnect or type your change."); return; }
        if (message.toolCallCancellation?.ids) { for (const id of message.toolCallCancellation.ids as string[]) { active.tools.get(id)?.abort(); active.tools.delete(id); } refreshActivity(); return; }
        if (message.toolCall?.functionCalls) { for (const call of message.toolCall.functionCalls) void runTool(call); return; }
        const content = message.serverContent;
        if (!content) return;
        if (content.interrupted) { stopPlayback(active); active.lastRole = null; refreshActivity(); }
        for (const part of content.modelTurn?.parts ?? []) if (part.inlineData?.data) play(fromBase64(part.inlineData.data));
        if (content.inputTranscription?.text) transcribe("user", content.inputTranscription.text);
        if (content.outputTranscription?.text) transcribe("assistant", content.outputTranscription.text);
        if (content.turnComplete) active.lastRole = null;
      };
      socket.onclose = () => { if (!active.closing) fail("Voice disconnected. Tap the microphone to reconnect."); };
      after(() => { if (!active.ready) fail("Voice didn't connect in time. Please try again."); }, 15000);
    } catch (caught) {
      // Nothing is stored in a session yet when setup fails early, so release what was opened.
      if (!session) {
        microphone?.getTracks().forEach(track => track.stop());
        void context?.close().catch(() => {});
        if (workletUrl) URL.revokeObjectURL(workletUrl);
      }
      if (generation.current !== ticket || controller.signal.aborted) return;
      const denied = caught instanceof DOMException && ["NotAllowedError", "PermissionDeniedError"].includes(caught.name);
      if (session) stop();
      starting.current = false;
      setStatus("error");
      setError(denied ? "Microphone access was declined. You can type a change or choose pieces below." : caught instanceof Error ? caught.message : "Voice couldn't connect. Please try again.");
    } finally { if (generation.current === ticket && !session) starting.current = false; }
  }, [stop, syncContext]);

  const toggleMute = useCallback(() => {
    const session = sessionRef.current;
    if (!session?.ready || session.closing) return;
    const next = !session.microphone?.getAudioTracks().some(track => !track.enabled);
    session.microphone?.getAudioTracks().forEach(track => { track.enabled = !next; });
    setMuted(next);
  }, []);

  return { status, activity, error, start, stop, muted, toggleMute };
}
