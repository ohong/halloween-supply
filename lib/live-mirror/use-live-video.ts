"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ManagedRealtimeSession, LucyRealtimeSession } from "@fal-ai/client/realtime";
import type { MirrorContext, MirrorStatus } from "./types";
import { videoOutfitRequest } from "./video-outfit";

type Reference = { image: string; prompt: string };
type VideoSession = {
  controller: AbortController;
  camera?: MediaStream;
  remote?: MediaStream;
  client?: ManagedRealtimeSession<LucyRealtimeSession>;
  timer?: ReturnType<typeof setTimeout>;
  disconnectedTimer?: ReturnType<typeof setTimeout>;
  firstFrameTimer?: ReturnType<typeof setTimeout>;
  appliedKey?: string;
  decoded: boolean;
  updating: boolean;
};
async function readResponse<T>(response: Response): Promise<T> {
  // Firewall blocks can arrive as HTML, so only the status is trusted for them.
  const body = await response.json().catch(() => ({}));
  if (!response.ok && (response.status === 429 || response.status === 403)) {
    throw new Error("The site blocked this mirror request. Your network may have reached its hourly session limit. Please try again later.");
  }
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The live mirror could not connect.");
  return body as T;
}
async function referenceFor(key: string, signal: AbortSignal) {
  return readResponse<Reference>(await fetch("/api/live-mirror/reference", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: key,
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  }));
}
const inputFor = (reference: Reference) => ({ prompt: reference.prompt, reference_image_url: reference.image, enable_prompt_expansion: false });
function release(session: VideoSession) {
  session.controller.abort();
  clearTimeout(session.timer);
  clearTimeout(session.firstFrameTimer);
  clearTimeout(session.disconnectedTimer);
  void session.client?.close().catch(() => {});
  session.camera?.getTracks().forEach(track => track.stop());
  session.remote?.getTracks().forEach(track => track.stop());
}

/** Video goes to Decart through fal signaling; only the voice session captures audio. */
export function useLiveVideo({ costume, outfit }: MirrorContext, externalCamera?: MediaStream | null) {
  const [status, setStatus] = useState<MirrorStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [sentKey, setSentKey] = useState<string | null>(null);
  const sessionRef = useRef<VideoSession | null>(null);
  const mounted = useRef(true);
  const outfitKey = JSON.stringify(videoOutfitRequest(costume, outfit));
  const latestKey = useRef(outfitKey);

  const fail = useCallback((session: VideoSession, message: string) => {
    if (sessionRef.current !== session) return;
    sessionRef.current = null;
    release(session);
    if (mounted.current) { setStream(null); setCameraStream(null); setSentKey(null); setError(message); setStatus("error"); }
  }, []);
  const stop = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) release(session);
    if (mounted.current) { setStream(null); setCameraStream(null); setSentKey(null); setStatus("idle"); setError(null); }
  }, []);
  const onFrame = useCallback(() => {
    const session = sessionRef.current;
    if (!session?.remote) return;
    session.decoded = true;
    clearTimeout(session.firstFrameTimer);
    if (!session.updating) setStatus("live");
  }, []);

  const update = useCallback(async (session: VideoSession) => {
    if (session.updating || !session.client || sessionRef.current !== session) return;
    session.updating = true;
    try {
      while (sessionRef.current === session && session.appliedKey !== latestKey.current) {
        const key = latestKey.current;
        setStatus("connecting");
        const reference = await referenceFor(key, session.controller.signal);
        if (sessionRef.current !== session) return;
        if (key !== latestKey.current) continue;
        session.client.send(inputFor(reference));
        // fal's control send has no garment-render acknowledgement. This tracks
        // the requested outfit, never proof that its pixels have appeared.
        session.appliedKey = key;
        setSentKey(key);
      }
      if (sessionRef.current === session) setStatus(session.decoded ? "live" : "connecting");
    } catch {
      if (sessionRef.current === session) fail(session, "The outfit could not be updated. Please reconnect.");
    } finally { session.updating = false; }
  }, [fail]);
  useEffect(() => {
    latestKey.current = outfitKey;
    const timer = setTimeout(() => { if (sessionRef.current) void update(sessionRef.current); }, 120);
    return () => clearTimeout(timer);
  }, [outfitKey, update]);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    const session: VideoSession = { controller: new AbortController(), updating: false, decoded: false };
    sessionRef.current = session;
    setError(null); setStream(null); setCameraStream(null); setSentKey(null); setStatus("connecting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Use HTTPS and allow camera access, or try photo try-on.");
      const [{ fal }, { lucyRealtime }] = await Promise.all([import("@fal-ai/client"), import("@fal-ai/client/realtime")]);
      if (sessionRef.current !== session) return;
      const camera = externalCamera ? new MediaStream(externalCamera.getVideoTracks().map(track => track.clone())) : await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", frameRate: { ideal: 30 }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      // Permission dialogs cannot be aborted; stop any late result after close.
      if (sessionRef.current !== session) { camera.getTracks().forEach(track => track.stop()); return; }
      session.camera = camera;
      setCameraStream(camera);
      camera.getVideoTracks().forEach(track => track.addEventListener("ended", () => fail(session, "Your camera stopped. Start the mirror again."), { once: true }));
      let key = latestKey.current;
      let reference = await referenceFor(key, session.controller.signal);
      while (sessionRef.current === session && key !== latestKey.current) {
        key = latestKey.current;
        reference = await referenceFor(key, session.controller.signal);
      }
      if (sessionRef.current !== session) return;
      const token = await readResponse<{ token: string; model: string; maxSessionSeconds: number }>(await fetch("/api/live-mirror/video", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: true }),
        signal: AbortSignal.any([session.controller.signal, AbortSignal.timeout(20_000)]),
      }));
      if (sessionRef.current !== session) return;
      session.timer = setTimeout(() => fail(session, "This three-minute mirror session has ended. Start again to keep trying pieces."), Math.min(token.maxSessionSeconds, 180) * 1000);
      session.firstFrameTimer = setTimeout(() => fail(session, "The mirror did not return video in time. Please try again."), 45_000);
      session.client = fal.realtime.open(lucyRealtime(), {
        endpointId: token.model, input: inputFor(reference), localStream: camera,
        abortSignal: session.controller.signal, negotiationTimeoutMs: 30_000,
        // One token per connection. Reconnect is explicit, never an automatic paid loop.
        tokenProvider: async () => token.token,
        onMedia: remote => {
          if (sessionRef.current !== session) { remote.getTracks().forEach(track => track.stop()); return; }
          session.remote = remote;
          setStream(remote);
        },
        onDiagnostic: event => {
          if (sessionRef.current !== session || event.kind !== "progress" || event.phase !== "connection-state") return;
          if (event.detail?.state === "disconnected") {
            setStatus("connecting");
            clearTimeout(session.disconnectedTimer);
            session.disconnectedTimer = setTimeout(() => fail(session, "The video connection was lost. Start again to reconnect."), 5000);
          } else if (event.detail?.state === "connected") {
            clearTimeout(session.disconnectedTimer);
            if (session.decoded && !session.updating) setStatus("live");
          }
        },
        onError: () => fail(session, "The live video connection failed. Please try again."),
        onState: state => { if (state === "closed") fail(session, "The live mirror disconnected. Start again to reconnect."); },
      });
      await session.client.ready;
      if (sessionRef.current !== session) return;
      session.appliedKey = key;
      setSentKey(key);
      await update(session);
    } catch (error) {
      if (sessionRef.current !== session) return;
      fail(session, error instanceof DOMException && error.name === "NotAllowedError"
        ? "Camera access was declined. Allow it in your browser to use the live mirror."
        : error instanceof DOMException && error.name === "NotFoundError"
          ? "No camera was found. Try photo try-on instead."
          : error instanceof Error ? error.message : "The live mirror could not start.");
    }
  }, [fail, update, externalCamera]);

  useEffect(() => {
    mounted.current = true;
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", stop);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", stop);
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) release(session);
    };
  }, [stop]);
  return { status, error, stream, cameraStream, isCurrent: status === "live" && sentKey === outfitKey, onFrame, start, stop };
}
