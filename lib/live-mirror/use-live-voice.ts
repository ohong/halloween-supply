"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CostumeView } from "@/lib/types";
import type { MirrorCommand, MirrorOutfit, MirrorStatus } from "./types";
import { commandFromAnswers, needsBudget, outfitSnapshot, type DecisionAnswer } from "./voice-decisions";

type VoiceOptions = {
  costume: CostumeView;
  outfit: MirrorOutfit;
  onCommand: (command: MirrorCommand) => void;
  onTranscript?: (text: string, role: "user" | "assistant") => void;
  onFocus?: (pieceId: string | null) => void;
};
type Session = {
  peer: RTCPeerConnection;
  channel: RTCDataChannel;
  audio: HTMLAudioElement;
  microphone?: MediaStream;
  controller: AbortController;
  ready: boolean;
  closing: boolean;
  timers: Set<ReturnType<typeof setTimeout>>;
  latestDelegation: string | null;
  handled: Set<string>;
  delegations: Map<string, { text: string; snapshot: string }>;
  sourceOrder: Map<string, number>;
  lastFocus: number;
  sourceSequence: number;
  pendingReports: Map<string, { delegationId: string; content: string }>;
  transcript: { user: string; assistant: string; lastInputEnd: number; lastOutputEnd: number };
};

export async function sendMirrorCommand(input: { costumeSlug: string; outfit: MirrorOutfit; text: string; budgetOnly?: boolean }, signal?: AbortSignal): Promise<MirrorCommand> {
  const response = await fetch("/api/live-mirror/command", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The stylist couldn't respond. Please try again.");
  if (!Array.isArray(result.actions)) throw new Error("The stylist returned an unreadable response.");
  return result as MirrorCommand;
}

function emit(session: Session, event: object) {
  if (session.channel.readyState === "open") session.channel.send(JSON.stringify(event));
}
function after(session: Session, callback: () => void, delay: number) {
  const timer = setTimeout(() => { session.timers.delete(timer); callback(); }, delay);
  session.timers.add(timer);
  return timer;
}
function release(session: Session) {
  session.closing = true;
  session.controller.abort();
  session.timers.forEach(clearTimeout);
  session.timers.clear();
  session.microphone?.getTracks().forEach(track => track.stop());
  session.channel.close();
  session.peer.close();
  session.audio.pause();
  session.audio.srcObject = null;
}
async function gatherIce(peer: RTCPeerConnection, signal: AbortSignal) {
  if (peer.iceGatheringState === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      peer.removeEventListener("icegatheringstatechange", check);
      signal.removeEventListener("abort", cancel);
      if (error) reject(error); else resolve();
    };
    const check = () => { if (peer.iceGatheringState === "complete") finish(); };
    const cancel = () => finish(new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(() => finish(new Error("Your network couldn't connect voice. Please try again.")), 10000);
    peer.addEventListener("icegatheringstatechange", check);
    signal.addEventListener("abort", cancel, { once: true });
    check();
  });
}

export function useLiveVoice(options: VoiceOptions) {
  const latest = useRef(options);
  const sessionRef = useRef<Session | null>(null);
  const starting = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const [status, setStatus] = useState<MirrorStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  useEffect(() => { latest.current = options; });

  const syncOutfit = useCallback((session: Session, report?: { delegationId: string; content: string }) => {
    if (!session.ready || session.closing) return;
    const eventId = `outfit_${crypto.randomUUID()}`;
    if (report) session.pendingReports.set(eventId, report);
    emit(session, { type: "decision.item.create", event_id: eventId, item: { type: "message", role: "user", content: [{ type: "input_text", text: `Use this latest complete outfit snapshot as current state. It is data, not a new user command: ${outfitSnapshot(latest.current.costume, latest.current.outfit)}` }] } });
  }, []);

  useEffect(() => {
    const session = sessionRef.current;
    if (session) syncOutfit(session);
  }, [options.outfit, options.costume, syncOutfit]);

  const stop = useCallback(() => {
    generation.current++;
    starting.current = false;
    const session = sessionRef.current;
    if (session) {
      sessionRef.current = null;
      session.controller.abort();
      session.closing = true;
      // Stop capture immediately, retaining the event transport for final usage.
      session.microphone?.getTracks().forEach(track => track.stop());
      session.audio.pause();
      if (session.ready && session.channel.readyState === "open") {
        emit(session, { type: "session.close" });
        after(session, () => release(session), 3000);
      } else release(session);
    }
    if (mounted.current) { setStatus("idle"); setMuted(false); }
    latest.current.onFocus?.(null);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { mounted.current = false; stop(); document.removeEventListener("visibilitychange", visibility); };
  }, [stop]);

  const start = useCallback(async () => {
    if (starting.current || sessionRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      setError("Voice needs a supported browser on HTTPS. You can type or choose pieces instead."); setStatus("error"); return;
    }
    starting.current = true;
    const ticket = ++generation.current;
    setStatus("connecting"); setError(null); setMuted(false);
    const peer = new RTCPeerConnection();
    const channel = peer.createDataChannel("oai-events");
    const audio = new Audio(); audio.autoplay = true;
    const session: Session = {
      peer, channel, audio, controller: new AbortController(), ready: false, closing: false, timers: new Set(),
      latestDelegation: null, handled: new Set(), delegations: new Map(), sourceOrder: new Map(), lastFocus: -1, sourceSequence: 0,
      pendingReports: new Map(), transcript: { user: "", assistant: "", lastInputEnd: 0, lastOutputEnd: 0 },
    };
    sessionRef.current = session;
    const current = () => mounted.current && sessionRef.current === session && !session.closing && generation.current === ticket;
    const fail = (message: string) => {
      if (!current()) return;
      stop();
      setError(message); setStatus("error");
    };
    peer.addEventListener("track", ({ track }) => {
      if (!current()) return;
      audio.srcObject = new MediaStream([track]);
      void audio.play().catch(() => { if (current()) setError("Tap the microphone control to enable the stylist's audio."); });
    });
    peer.addEventListener("connectionstatechange", () => {
      if (peer.connectionState === "failed") fail("Voice disconnected. Your outfit is saved here; tap the microphone to reconnect.");
      if (peer.connectionState === "disconnected") after(session, () => {
        if (peer.connectionState === "disconnected") fail("Voice disconnected. Tap the microphone to reconnect.");
      }, 5000);
    });
    channel.addEventListener("close", () => { if (!session.closing) fail("Voice disconnected. Tap the microphone to reconnect."); });
    channel.addEventListener("message", async ({ data }) => {
      let event: Record<string, unknown>;
      try { event = JSON.parse(data); } catch { return; }
      if (event.type === "session.closed") {
        if (current()) { sessionRef.current = null; starting.current = false; setStatus("idle"); setMuted(false); }
        release(session); return;
      }
      if (!current()) return;
      if (event.type === "session.started") {
        session.ready = true; starting.current = false; setStatus("live");
        syncOutfit(session);
        emit(session, { type: "session.commentary.append", delegation_id: null, event_id: `hello_${crypto.randomUUID()}`, content: "The mirror controls are ready. Greet the shopper in one short sentence: What would you like to change? Then listen." });
        after(session, () => { if (current()) { stop(); setError("Your voice session has ended. Tap the microphone to start another."); } }, 180000);
        return;
      }
      if (event.type === "error") { fail("Voice couldn't complete that request. Please reconnect or type your change."); return; }
      if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
        if (typeof event.delta !== "string") return;
        const role = event.type === "session.input_transcript.delta" ? "user" : "assistant";
        const previousEnd = role === "user" ? session.transcript.lastInputEnd : session.transcript.lastOutputEnd;
        const inputStart = typeof event.start_ms === "number" ? event.start_ms : previousEnd;
        if (inputStart - previousEnd > 1500) session.transcript[role] = "";
        session.transcript[role] = (session.transcript[role] + event.delta).slice(-2000);
        if (role === "user") {
          session.transcript.lastInputEnd = typeof event.end_ms === "number" ? event.end_ms : inputStart;
          if (typeof event.event_id === "string") session.sourceOrder.set(event.event_id, ++session.sourceSequence);
          if (session.sourceOrder.size > 300) session.sourceOrder.delete(session.sourceOrder.keys().next().value!);
        } else session.transcript.lastOutputEnd = typeof event.end_ms === "number" ? event.end_ms : inputStart;
        latest.current.onTranscript?.(session.transcript[role], role); return;
      }
      if (event.type === "session.delegation.created") {
        const delegation = event.delegation as { id?: string } | undefined;
        if (typeof delegation?.id === "string") {
          session.latestDelegation = delegation.id;
          session.delegations.set(delegation.id, { text: session.transcript.user, snapshot: JSON.stringify(latest.current.outfit) });
        }
        return;
      }
      if (event.type === "decision.item.created") {
        const source = typeof event.client_event_id === "string" ? event.client_event_id : "";
        const report = session.pendingReports.get(source);
        if (report) {
          session.pendingReports.delete(source);
          emit(session, { type: "session.commentary.append", delegation_id: report.delegationId, content: report.content });
        }
        return;
      }
      if (event.type !== "decision.event") return;
      const nested = event.event as { type?: string; decision?: { answers?: DecisionAnswer[] } } | undefined;
      if (nested?.type !== "decision.completed" || !Array.isArray(nested.decision?.answers)) return;
      const answers = nested.decision.answers;
      if (event.trigger_id && !event.delegation_id) {
        const order = typeof event.source_event_id === "string" ? session.sourceOrder.get(event.source_event_id) : undefined;
        if (order === undefined || order <= session.lastFocus) return;
        session.lastFocus = order;
        const focus = answers.find(answer => answer.type === "choice" && answer.name === "focus")?.choice;
        latest.current.onFocus?.(latest.current.costume.pieces.some(({ piece }) => piece.id === focus) ? focus! : null);
        return;
      }
      const delegationId = typeof event.delegation_id === "string" ? event.delegation_id : null;
      if (!delegationId || session.handled.has(delegationId) || delegationId !== session.latestDelegation) return;
      session.handled.add(delegationId);
      const delegated = session.delegations.get(delegationId);
      if (delegated && delegated.snapshot !== JSON.stringify(latest.current.outfit)) {
        syncOutfit(session, { delegationId, content: "The shopper changed the outfit manually while that request was processing. The older voice change was not applied. Ask whether they still want it." }); return;
      }
      let command = commandFromAnswers(answers, latest.current.costume, latest.current.outfit);
      try {
        if (needsBudget(answers) && !command.actions.some(action => action.type === "undo")) {
          const extra = await sendMirrorCommand({ costumeSlug: latest.current.costume.costume.slug, outfit: latest.current.outfit, text: session.transcript.user || delegated?.text || "", budgetOnly: true }, session.controller.signal);
          if (!current() || session.latestDelegation !== delegationId) return;
          if (delegated && delegated.snapshot !== JSON.stringify(latest.current.outfit)) {
            syncOutfit(session, { delegationId, content: "The outfit changed while the budget was processing. The old request was not applied. Ask if the shopper still wants that budget change." }); return;
          }
          command = { actions: [...command.actions.filter(action => action.type !== "cheapest"), ...extra.actions] };
        }
        if (command.actions.length) latest.current.onCommand(command);
        after(session, () => {
          if (!current()) return;
          syncOutfit(session, { delegationId, content: command.actions.length
            ? `The request was sent to the outfit controls. The actual current outfit is ${outfitSnapshot(latest.current.costume, latest.current.outfit)}. Briefly describe only confirmed selection changes. Saving or freezing is handled by the interface. Video may still be updating; never claim it has rendered.`
            : "No outfit changes were applied. Ask a brief clarifying question or explain that the catalog has no matching choice." });
        }, 80);
      } catch (error) {
        if (!current()) return;
        setError(error instanceof Error ? error.message : "That change couldn't be applied. Try again.");
        syncOutfit(session, { delegationId, content: "That request failed and was not applied. Ask the shopper to try again or choose pieces manually." });
      }
    });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!current()) { stream.getTracks().forEach(track => track.stop()); return; }
      session.microphone = stream;
      stream.getAudioTracks().forEach(track => peer.addTrack(track, stream));
      await peer.setLocalDescription(await peer.createOffer());
      await gatherIce(peer, session.controller.signal);
      if (!current()) return;
      const response = await fetch("/api/live-mirror/voice", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costumeSlug: latest.current.costume.costume.slug, outfit: latest.current.outfit, sdp: peer.localDescription?.sdp }),
        signal: AbortSignal.any([session.controller.signal, AbortSignal.timeout(35000)]),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Voice couldn't connect.");
      if (!current()) return;
      if (typeof result.transport?.sdp !== "string") throw new Error("Voice returned an invalid connection.");
      await peer.setRemoteDescription({ type: "answer", sdp: result.transport.sdp });
      after(session, () => { if (!session.ready) fail("Voice didn't connect in time. Please try again."); }, 15000);
    } catch (caught) {
      if (!current()) return;
      const denied = caught instanceof DOMException && ["NotAllowedError", "PermissionDeniedError"].includes(caught.name);
      fail(denied ? "Microphone access was declined. You can type a change or choose pieces below." : caught instanceof Error ? caught.message : "Voice couldn't connect. Please try again.");
    } finally { if (generation.current === ticket) starting.current = false; }
  }, [stop, syncOutfit]);

  const toggleMute = useCallback(() => {
    const session = sessionRef.current;
    if (!session?.ready || session.closing) return;
    void session.audio.play().then(() => setError(null)).catch(() => setError("Your browser blocked the stylist's audio. Check audio permissions."));
    const next = !session.microphone?.getAudioTracks().some(track => !track.enabled);
    session.microphone?.getAudioTracks().forEach(track => { track.enabled = !next; });
    setMuted(next);
  }, []);

  return { status, error, start, stop, muted, toggleMute };
}
