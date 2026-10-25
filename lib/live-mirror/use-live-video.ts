"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ManagedRealtimeSession, LucyRealtimeSession } from "@fal-ai/client/realtime";
import type { MirrorContext, MirrorStatus } from "./types";
import { videoOutfitRequest } from "./video-outfit";
import { readMirrorResponse } from "./read-response";

type Reference = { image: string; prompt: string };
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
};
async function referenceFor(key: string, signal: AbortSignal) {
  return readMirrorResponse<Reference>(await fetch("/api/live-mirror/reference", {
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
  const [facingMode, setFacingMode] = useState<FacingMode>("user");
  const facingRef = useRef<FacingMode>("user");
  const [canSwitchCamera, setCanSwitchCamera] = useState(false);
  const [switchingCamera, setSwitchingCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const sessionRef = useRef<VideoSession | null>(null);
  const mounted = useRef(true);
  const outfitKey = JSON.stringify(videoOutfitRequest(costume, outfit));
  const latestKey = useRef(outfitKey);

  const fail = useCallback((session: VideoSession, message: string) => {
    if (sessionRef.current !== session) return;
    sessionRef.current = null;
    release(session);
    if (mounted.current) { setStream(null); setCameraStream(null); setSentKey(null); setSwitchingCamera(false); setCanSwitchCamera(false); setCameraError(null); setError(message); setStatus("error"); }
  }, []);
  const stop = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) release(session);
    if (mounted.current) { setStream(null); setCameraStream(null); setSentKey(null); setSwitchingCamera(false); setCanSwitchCamera(false); setCameraError(null); setStatus("idle"); setError(null); }
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
    const session: VideoSession = { controller: new AbortController(), updating: false, decoded: false, external: !!externalCamera };
    sessionRef.current = session;
    setError(null); setStream(null); setCameraStream(null); setSentKey(null); setStatus("connecting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Use HTTPS and allow camera access, or try photo try-on.");
      const [{ fal }, { lucyRealtime }] = await Promise.all([import("@fal-ai/client"), import("@fal-ai/client/realtime")]);
      if (sessionRef.current !== session) return;
      const camera = externalCamera ? new MediaStream(externalCamera.getVideoTracks().map(track => track.clone())) : await navigator.mediaDevices.getUserMedia(cameraConstraints({ ideal: facingRef.current }));
      // Permission dialogs cannot be aborted; stop any late result after close.
      if (sessionRef.current !== session) { camera.getTracks().forEach(track => track.stop()); return; }
      attachCamera(session, camera, facingRef.current);
      let key = latestKey.current;
      let reference = await referenceFor(key, session.controller.signal);
      while (sessionRef.current === session && key !== latestKey.current) {
        key = latestKey.current;
        reference = await referenceFor(key, session.controller.signal);
      }
      if (sessionRef.current !== session) return;
      const token = await readMirrorResponse<{ token: string; model: string; maxSessionSeconds: number | null }>(await fetch("/api/live-mirror/video", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: true }),
        signal: AbortSignal.any([session.controller.signal, AbortSignal.timeout(20_000)]),
      }));
      if (sessionRef.current !== session) return;
      if (token.maxSessionSeconds !== null) session.timer = setTimeout(() => fail(session, "This mirror session has ended. Start again to keep trying pieces."), Math.min(token.maxSessionSeconds ?? 180, 180) * 1000);
      session.firstFrameTimer = setTimeout(() => fail(session, "The mirror did not return video in time. Please try again."), 45_000);
      session.client = fal.realtime.open(lucyRealtime(), {
        endpointId: token.model, input: inputFor(reference), localStream: camera,
        abortSignal: session.controller.signal, negotiationTimeoutMs: 30_000,
        peerConnectionFactory: configuration => {
          const peer = new RTCPeerConnection(configuration);
          session.peer = peer;
          return peer;
        },
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
        onError: error => {
          // SDK failures are classified without logging signaling URLs or tokens.
          const message = error instanceof Error ? error.message : "";
          const reason = message.includes("signaling") ? "signaling" : message.includes("timed out") ? "timeout" : message.includes("ICE") ? "ice" : "transport";
          console.warn(`[live-mirror] Video connection failed (${reason}).`);
          fail(session, "The live video connection failed. Please try again.");
        },
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
  return { status, error, stream, cameraStream, facingMode, canSwitchCamera, switchingCamera, cameraError, switchCamera,
    isCurrent: status === "live" && sentKey === outfitKey && !switchingCamera, onFrame, start, stop };
}
