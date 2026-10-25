"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealTimeClient } from "@decartai/sdk";
import type { MirrorContext, MirrorStatus } from "./types";
import { videoOutfitRequest } from "./video-outfit";

type Reference = { image: string; prompt: string };
type VideoSession = {
  controller: AbortController;
  camera?: MediaStream;
  remote?: MediaStream;
  client?: RealTimeClient;
  timer?: ReturnType<typeof setTimeout>;
  appliedKey?: string;
  updating: boolean;
};

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The live mirror could not connect.");
  return body as T;
}

async function referenceFor(key: string, signal: AbortSignal) {
  return readResponse<Reference>(await fetch("/api/live-mirror/reference", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: key,
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  }));
}

async function within<T>(work: Promise<T>, milliseconds: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function release(session: VideoSession) {
  session.controller.abort();
  clearTimeout(session.timer);
  try { session.client?.disconnect(); } catch { /* Camera release must survive transport cleanup failures. */ }
  session.camera?.getTracks().forEach((track) => track.stop());
  session.remote?.getTracks().forEach((track) => track.stop());
}

/** Camera and Decart own only video. Microphone audio stays in the voice session. */
export function useLiveVideo({ costume, outfit }: MirrorContext) {
  const [status, setStatus] = useState<MirrorStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [renderedKey, setRenderedKey] = useState<string | null>(null);
  const sessionRef = useRef<VideoSession | null>(null);
  const mounted = useRef(true);
  const outfitKey = JSON.stringify(videoOutfitRequest(costume, outfit));
  const latestKey = useRef(outfitKey);

  const fail = useCallback((session: VideoSession, message: string) => {
    if (sessionRef.current !== session) return;
    sessionRef.current = null;
    release(session);
    if (mounted.current) { setStream(null); setRenderedKey(null); setError(message); setStatus("error"); }
  }, []);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) release(session);
    if (mounted.current) { setStream(null); setRenderedKey(null); setStatus("idle"); setError(null); }
  }, []);

  const update = useCallback(async (session: VideoSession) => {
    if (session.updating || !session.client || sessionRef.current !== session) return;
    session.updating = true;
    try {
      while (sessionRef.current === session && session.appliedKey !== latestKey.current) {
        const key = latestKey.current;
        setStatus("connecting");
        // Keep the video visible; isCurrent prevents saving the previous outfit.
        const reference = await referenceFor(key, session.controller.signal);
        if (sessionRef.current !== session) return;
        if (key !== latestKey.current) continue;
        await within(session.client.set({ prompt: reference.prompt, image: reference.image, enhance: false }), 20_000, "The outfit update took too long. Please reconnect.");
        if (sessionRef.current !== session) return;
        session.appliedKey = key;
      }
      if (sessionRef.current === session) {
        setStream(session.remote ?? null);
        setRenderedKey(session.appliedKey ?? null);
        setStatus(session.remote ? "live" : "connecting");
      }
    } catch (error) {
      if (sessionRef.current === session) fail(session, error instanceof Error ? error.message : "The outfit could not be updated. Please reconnect.");
    } finally { session.updating = false; }
  }, [fail]);

  useEffect(() => {
    latestKey.current = outfitKey;
    const timer = setTimeout(() => {
      const session = sessionRef.current;
      if (session) void update(session);
    }, 350);
    return () => clearTimeout(timer);
  }, [outfitKey, update]);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    const session: VideoSession = { controller: new AbortController(), updating: false };
    sessionRef.current = session;
    setError(null); setStream(null); setRenderedKey(null); setStatus("connecting");
    try {
      const config = await readResponse<{ videoAvailable: boolean }>(await fetch("/api/live-mirror/video", { signal: AbortSignal.any([session.controller.signal, AbortSignal.timeout(10_000)]), cache: "no-store" }));
      if (!config.videoAvailable) throw new Error("Live video try-on is not available yet. You can still build your outfit and use photo try-on.");
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Your browser cannot open a camera here. Use HTTPS and allow camera access, or try photo try-on.");
      const { createDecartClient, models, noopLogger } = await import("@decartai/sdk");
      if (sessionRef.current !== session) return;
      const model = models.realtime("lucy-vton-3.6");
      let key = latestKey.current;
      let reference = await referenceFor(key, session.controller.signal);
      while (sessionRef.current === session && key !== latestKey.current) {
        key = latestKey.current;
        reference = await referenceFor(key, session.controller.signal);
      }
      if (sessionRef.current !== session) return;
      const camera = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", frameRate: model.fps, width: { ideal: model.width }, height: { ideal: model.height } },
      });
      // getUserMedia cannot be aborted: stop late permission results after close.
      if (sessionRef.current !== session) { camera.getTracks().forEach((track) => track.stop()); return; }
      session.camera = camera;
      session.timer = setTimeout(() => fail(session, "This three-minute mirror session has ended. Start again to keep trying pieces."), 180_000);
      const client = createDecartClient({
        telemetry: false, logger: noopLogger,
        apiKeyProvider: async () => {
          if (sessionRef.current !== session) throw new Error("Mirror session closed.");
          const token = await readResponse<{ apiKey: string }>(await fetch("/api/live-mirror/video", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: true }), signal: AbortSignal.any([session.controller.signal, AbortSignal.timeout(20_000)]),
          }));
          return token.apiKey;
        },
      });
      const connecting = client.realtime.connect(camera, {
        model, mirror: "auto", retries: 1, capacityRetryBudgetMs: 10_000,
        initialState: { prompt: { text: reference.prompt, enhance: false }, image: reference.image },
        onRemoteStream: (remote) => {
          if (sessionRef.current !== session) { remote.getTracks().forEach((track) => track.stop()); return; }
          session.remote = remote;
          if (!session.updating && (session.appliedKey ?? key) === latestKey.current) { setStream(remote); setRenderedKey(session.appliedKey ?? key); setStatus("live"); }
        },
        onConnectionChange: (connection) => {
          if (sessionRef.current !== session) return;
          if (connection === "reconnecting") { setStream(null); setStatus("connecting"); }
          if ((connection === "connected" || connection === "generating") && session.remote && !session.updating && session.appliedKey === latestKey.current) {
            setStream(session.remote); setRenderedKey(session.appliedKey); setStatus("live");
          }
          if (connection === "disconnected") fail(session, "The live mirror disconnected. Start again to reconnect.");
        },
      }).then((connected) => {
        // A timed-out connect can still resolve; never leave that session running.
        if (sessionRef.current !== session) connected.disconnect();
        return connected;
      });
      const connected = await within(connecting, 30_000, "The live mirror took too long to connect. Please try again.");
      if (sessionRef.current !== session) { connected.disconnect(); return; }
      session.client = connected;
      session.appliedKey = key;
      connected.on("sessionEnded", () => fail(session, "This live mirror session has ended. Start again to reconnect."));
      connected.on("error", () => fail(session, "The live video service could not update the mirror. Please reconnect."));
      // The user may have edited pieces while camera permission or connection was pending.
      await update(session);
    } catch (error) {
      if (sessionRef.current !== session) return;
      const message = error instanceof DOMException && error.name === "NotAllowedError"
        ? "Camera access was declined. Allow it in your browser to use the live mirror."
        : error instanceof DOMException && error.name === "NotFoundError"
          ? "No camera was found. Try photo try-on instead."
          : error instanceof Error ? error.message : "The live mirror could not start.";
      fail(session, message);
    }
  }, [fail, update]);

  useEffect(() => {
    mounted.current = true;
    const onVisibility = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stop);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stop);
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) release(session);
    };
  }, [stop]);

  const isCurrent = status === "live" && stream !== null && renderedKey === outfitKey;
  return { status, error, stream, isCurrent, start, stop };
}
