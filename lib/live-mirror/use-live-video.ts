"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ManagedRealtimeSession, LucyRealtimeSession } from "@fal-ai/client/realtime";
import type { MirrorContext, MirrorStatus } from "./types";
import { videoOutfitRequest } from "./video-outfit";
import { readMirrorResponse } from "./read-response";
import { recordMirrorTiming } from "./timing";
import { lucyWithFailures, videoFailureFor, type VideoFailure } from "./video-failure";

type Reference = { prompt: string };
type FacingMode = "user" | "environment";
const cameraConstraints = (facingMode: MediaTrackConstraints["facingMode"], deviceId?: string): MediaStreamConstraints => ({
  audio: false,
  video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode }), frameRate: { ideal: 30 }, width: { ideal: 1280 }, height: { ideal: 720 } },
});
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
  peer?: RTCPeerConnection;
  switching?: boolean;
  external: boolean;
  attempt: number;
  startedAt: number;
  openedAt?: number;
  attemptController?: AbortController;
};
async function referenceFor(key: string, signal: AbortSignal) {
  return readMirrorResponse<Reference>(await fetch("/api/live-mirror/reference", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: key,
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  }));
}
const inputFor = (reference: Reference) => ({ prompt: reference.prompt, enable_prompt_expansion: false });
async function closeAttempt(session: VideoSession) {
  session.attemptController?.abort();
  clearTimeout(session.firstFrameTimer);
  clearTimeout(session.disconnectedTimer);
  await session.client?.close().catch(() => {});
  session.client = undefined;
  session.remote?.getTracks().forEach(track => track.stop());
  session.remote = undefined;
  session.peer = undefined;
  session.updating = false;
}
function release(session: VideoSession) {
  session.controller.abort();
  clearTimeout(session.timer);
  void closeAttempt(session);
  session.camera?.getTracks().forEach(track => track.stop());
}
function waitToRetry(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, ms);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

/** Video goes to Decart through fal signaling; only the voice session captures audio. */
export function useLiveVideo({ costume, outfit }: MirrorContext, externalCamera?: MediaStream | null) {
  const [status, setStatus] = useState<MirrorStatus>("idle");
  const [recovery, setRecovery] = useState<string | null>(null);
  const [hasFrames, setHasFrames] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [sentKey, setSentKey] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<FacingMode>("user");
  const facingRef = useRef<FacingMode>("user");
  const [canSwitchCamera, setCanSwitchCamera] = useState(false);
  const [switchingCamera, setSwitchingCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const sessionRef = useRef<VideoSession | null>(null);
  const mounted = useRef(true);
  const outfitKey = JSON.stringify(videoOutfitRequest(costume, outfit));
  const latestKey = useRef(outfitKey);
  const keyChangedAt = useRef(0);

  const fail = useCallback((session: VideoSession, message: string) => {
    if (sessionRef.current !== session) return;
    sessionRef.current = null;
    release(session);
    if (mounted.current) { setStream(null); setHasFrames(false); setRecovery(null); setCameraStream(null); setSentKey(null); setSwitchingCamera(false); setCanSwitchCamera(false); setCameraError(null); setError(message); setStatus("error"); }
  }, []);
  const stop = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) release(session);
    if (mounted.current) { setStream(null); setHasFrames(false); setRecovery(null); setCameraStream(null); setSentKey(null); setSwitchingCamera(false); setCanSwitchCamera(false); setCameraError(null); setStatus("idle"); setError(null); }
  }, []);
  const attachCamera = useCallback((session: VideoSession, camera: MediaStream, facing: FacingMode) => {
    session.camera = camera;
    const track = camera.getVideoTracks()[0];
    const actualFacing = track?.getSettings().facingMode;
    facingRef.current = actualFacing === "user" || actualFacing === "environment" ? actualFacing : facing;
    setFacingMode(facingRef.current);
    setCameraStream(camera);
    track?.addEventListener("ended", () => {
      if (session.camera === camera) fail(session, "Your camera stopped. Start the mirror again.");
    }, { once: true });
    if (!session.external) void navigator.mediaDevices.enumerateDevices().then(devices => {
      if (sessionRef.current === session) setCanSwitchCamera(devices.filter(device => device.kind === "videoinput").length > 1);
    }).catch(() => {});
  }, [fail]);

  const switchCamera = useCallback(async () => {
    const session = sessionRef.current;
    const sender = session?.peer?.getSenders().find(sender => sender.track?.kind === "video");
    if (!session?.camera || session.external || session.switching || !sender) return;
    const previousFacing = facingRef.current;
    const previousDevice = session.camera.getVideoTracks()[0]?.getSettings().deviceId;
    const nextFacing = previousFacing === "user" ? "environment" : "user";
    session.switching = true;
    setSwitchingCamera(true);
    setCameraError(null);
    // Phones may only open one lens at a time. The sender and voice connection
    // stay alive while the old camera releases its hardware.
    const previousCamera = session.camera;
    session.camera = undefined;
    previousCamera.getTracks().forEach(track => track.stop());
    setCameraStream(null);
    const replace = async (constraints: MediaStreamConstraints, facing: FacingMode) => {
      const camera = await navigator.mediaDevices.getUserMedia(constraints);
      try {
        if (sessionRef.current !== session) return;
        const track = camera.getVideoTracks()[0];
        if (!track) throw new Error("No video track");
        await sender.replaceTrack(track);
        if (sessionRef.current !== session) return;
        attachCamera(session, camera, facing);
      } finally {
        // Permission and replaceTrack can finish after the room has closed.
        if (session.camera !== camera) camera.getTracks().forEach(track => track.stop());
      }
    };
    try {
      await replace(cameraConstraints({ exact: nextFacing }), nextFacing);
    } catch {
      if (sessionRef.current !== session) return;
      try {
        await replace(cameraConstraints({ ideal: previousFacing }, previousDevice), previousFacing);
        if (sessionRef.current === session) setCameraError("That camera could not open. Your previous camera is back. Try again.");
      } catch {
        fail(session, "Your camera could not restart. Start the mirror again, or try photo mode.");
      }
    } finally {
      session.switching = false;
      if (sessionRef.current === session) setSwitchingCamera(false);
    }
  }, [fail, attachCamera]);
  const onFrame = useCallback(() => {
    const session = sessionRef.current;
    if (!session?.remote) return;
    if (!session.decoded) recordMirrorTiming("first_frame", session.openedAt ?? session.startedAt, "video");
    session.decoded = true;
    setHasFrames(true);
    setRecovery(null);
    clearTimeout(session.firstFrameTimer);
    if (!session.updating) setStatus("live");
  }, []);

  const update = useCallback(async (session: VideoSession) => {
    if (session.updating || !session.client || sessionRef.current !== session) return;
    const client = session.client;
    session.updating = true;
    try {
      while (sessionRef.current === session && session.client === client && session.appliedKey !== latestKey.current) {
        const key = latestKey.current;
        setStatus("connecting");
        const reference = await referenceFor(key, AbortSignal.any([session.controller.signal, session.attemptController!.signal]));
        if (sessionRef.current !== session || session.client !== client) return;
        if (key !== latestKey.current) continue;
        client.send(inputFor(reference));
        recordMirrorTiming("provider_send", keyChangedAt.current, "video");
        // fal's control send has no garment-render acknowledgement. This tracks
        // the requested outfit, never proof that its pixels have appeared.
        session.appliedKey = key;
        setSentKey(key);
      }
      if (sessionRef.current === session && session.client === client) setStatus(session.decoded ? "live" : "connecting");
    } catch {
      if (sessionRef.current === session && session.client === client && !session.attemptController?.signal.aborted) fail(session, "The outfit could not be updated. Please reconnect.");
    } finally { if (session.client === client) session.updating = false; }
  }, [fail]);
  useEffect(() => {
    latestKey.current = outfitKey;
    keyChangedAt.current = performance.now();
    const timer = setTimeout(() => { if (sessionRef.current) void update(sessionRef.current); }, 120);
    return () => clearTimeout(timer);
  }, [outfitKey, update]);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    const session: VideoSession = { controller: new AbortController(), updating: false, decoded: false, external: !!externalCamera, attempt: 0, startedAt: performance.now() };
    sessionRef.current = session;
    setError(null); setRecovery(null); setStream(null); setHasFrames(false); setCameraStream(null); setSentKey(null); setStatus("connecting");
    const current = () => sessionRef.current === session;
    try {
      if (!externalCamera && !navigator.mediaDevices?.getUserMedia) throw new Error("Use HTTPS and allow camera access, or try photo try-on.");
      const { fal } = await import("@fal-ai/client");
      if (!current()) return;
      if (externalCamera && !externalCamera.getVideoTracks().some(track => track.readyState === "live")) throw new Error("Your phone camera stopped. Connect your phone again.");
      const camera = externalCamera ? new MediaStream(externalCamera.getVideoTracks().map(track => track.clone())) : await navigator.mediaDevices.getUserMedia(cameraConstraints({ ideal: facingRef.current }));
      // Permission dialogs cannot be aborted; stop any late result after close.
      if (!current()) { camera.getTracks().forEach(track => track.stop()); return; }
      attachCamera(session, camera, facingRef.current);
      // Keep camera ownership separate from each provider attempt. Retrying Lucy
      // must never stop the paired phone or acquire this computer's camera.
      for (let attempt = 0; attempt < 3 && current(); attempt++) {
        session.attempt = attempt;
        session.attemptController = new AbortController();
        session.decoded = false;
        session.appliedKey = undefined;
        let providerFailure: VideoFailure | undefined;
        let rejectAttempt!: (reason: unknown) => void;
        const failure = new Promise<never>((_, reject) => { rejectAttempt = reject; });
        // Errors may arrive while reference/token requests are still pending.
        void failure.catch(() => {});
        const cancel = () => rejectAttempt(session.controller.signal.reason);
        session.controller.signal.addEventListener("abort", cancel, { once: true });
        const active = () => current() && session.attempt === attempt;
        try {
          let key = latestKey.current;
          let reference = await referenceFor(key, session.controller.signal);
          while (current() && key !== latestKey.current) {
            key = latestKey.current;
            reference = await referenceFor(key, session.controller.signal);
          }
          if (!current()) return;
          const token = await readMirrorResponse<{ token: string; model: string; maxSessionSeconds: number | null }>(await fetch("/api/live-mirror/video", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: true }),
            signal: AbortSignal.any([session.controller.signal, AbortSignal.timeout(20_000)]),
          }));
          if (!current()) return;
          // Recovery does not extend the room's duration or spending window.
          if (!session.timer && token.maxSessionSeconds !== null) session.timer = setTimeout(() => fail(session, "This mirror session has ended. Start again to keep trying pieces."), Math.min(token.maxSessionSeconds ?? 180, 180) * 1000);
          session.firstFrameTimer = setTimeout(() => rejectAttempt(new Error("The mirror did not return video in time.")), 45_000);
          session.openedAt = performance.now();
          session.client = fal.realtime.open(lucyWithFailures(token.model, reason => { providerFailure = reason; }), {
            endpointId: token.model, input: inputFor(reference), localStream: session.camera,
            abortSignal: session.controller.signal, negotiationTimeoutMs: 30_000,
            peerConnectionFactory: configuration => {
              const peer = new RTCPeerConnection(configuration);
              session.peer = peer;
              return peer;
            },
            // A fresh short-lived token belongs to each bounded attempt.
            tokenProvider: async () => token.token,
            onMedia: remote => {
              if (!active()) { remote.getTracks().forEach(track => track.stop()); return; }
              session.remote = remote;
              setStream(remote);
            },
            onDiagnostic: event => {
              if (!active() || event.kind !== "progress" || event.phase !== "connection-state") return;
              if (event.detail?.state === "disconnected") {
                setStatus("connecting");
                clearTimeout(session.disconnectedTimer);
                session.disconnectedTimer = setTimeout(() => rejectAttempt(new Error("The video transport disconnected.")), 8000);
              } else if (event.detail?.state === "connected") {
                clearTimeout(session.disconnectedTimer);
                if (session.decoded && !session.updating) setStatus("live");
              }
            },
            onError: error => { if (active()) rejectAttempt(error); },
            onState: state => { if (active() && state === "closed") rejectAttempt(new Error("The live video transport closed.")); },
          });
          recordMirrorTiming("provider_connect", session.startedAt, "video");
          await Promise.race([session.client.ready, failure]);
          if (!current()) return;
          session.appliedKey = key;
          setSentKey(key);
          await update(session);
          await failure;
        } catch (error) {
          if (!current()) return;
          const reason = providerFailure ?? videoFailureFor(error);
          console.warn(`[live-mirror] Video connection failed (${reason.code}; attempt ${attempt + 1}/3).`);
          await closeAttempt(session);
          if (!current()) return;
          setStream(null); setHasFrames(false); setSentKey(null);
          if (!reason.retryable || attempt === 2) { fail(session, reason.message); return; }
          setStatus("connecting");
          setRecovery(`Reconnecting costume video… Attempt ${attempt + 2} of 3. Your camera stays connected.`);
          await waitToRetry(reason.code === "capacity" ? (attempt + 1) * 8000 : attempt === 0 ? 3000 : 10000, session.controller.signal);
        } finally {
          session.controller.signal.removeEventListener("abort", cancel);
        }
      }
    } catch (error) {
      if (!current()) return;
      fail(session, error instanceof DOMException && error.name === "NotAllowedError"
        ? "Camera access was declined. Allow it in your browser to use the live mirror."
        : error instanceof DOMException && error.name === "NotFoundError"
          ? "No camera was found. Try photo try-on instead."
          : error instanceof Error ? error.message : "The live mirror could not start.");
    }
  }, [fail, update, externalCamera, attachCamera]);

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
  return { status, error, recovery, hasFrames, stream, cameraStream, facingMode, canSwitchCamera, switchingCamera, cameraError, switchCamera,
    isCurrent: status === "live" && sentKey === outfitKey && !switchingCamera, onFrame, start, stop };
}
