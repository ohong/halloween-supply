"use client";

import { useEffect, useRef, useState } from "react";
import { frame, connectPeer, pairRequest, sendPhoto } from "@/lib/phone-camera/connection";
import "./virtual-try-on.css";
import "./phone-camera.css";

type Session = { id: string; token: string; controller: AbortController; peer?: RTCPeerConnection; channel?: RTCDataChannel; stream?: MediaStream; expiry?: ReturnType<typeof setTimeout>; heartbeat?: ReturnType<typeof setInterval>; lastPing: number };
export function PhoneCapture() {
  const sessionRef = useRef<Session | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected">("idle");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [audio, setAudio] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [switching, setSwitching] = useState(false);
  const takingPhoto = useRef(false);
  const capturePending = useRef<ReturnType<typeof setTimeout> | null>(null);
  function stop(message = "Camera sharing stopped.") {
    const session = sessionRef.current; sessionRef.current = null;
    if (session) {
      if (session.channel?.readyState === "open") session.channel.send(JSON.stringify({ type: "stop" }));
      session.controller.abort(); clearTimeout(session.expiry); clearInterval(session.heartbeat);
      session.stream?.getTracks().forEach(track => track.stop()); session.peer?.close();
      void fetch(`/api/camera-pair/${session.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${session.token}` }, keepalive: true }).catch(() => {});
    }
    takingPhoto.current = false;
    if (capturePending.current) clearTimeout(capturePending.current);
    if (video.current) video.current.srcObject = null;
    setStatus("idle"); setNote(message);
  }
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop("Sharing stopped because this page was hidden. Scan a new code to reconnect."); };
    const leave = () => stop();
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", leave);
    return () => { document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", leave); stop(); };
  }, []);
  async function start() {
    if (sessionRef.current) return;
    setError(""); setNote(""); setStatus("connecting");
    const [id, token] = location.hash.slice(1).split(".");
    if (!/^[a-f0-9]{64}$/.test(id ?? "") || !/^[a-f0-9]{64}$/.test(token ?? "")) { setStatus("idle"); setError("Scan a new QR code from the costume page on your computer."); return; }
    const session: Session = { id, token, controller: new AbortController(), lastPing: Date.now() }; sessionRef.current = session;
    const current = () => sessionRef.current === session;
    const fail = (message: string) => { if (current()) { stop(""); setError(message); } };
    try {
      const claimant = crypto.randomUUID();
      const config = await pairRequest<{ iceServers: RTCIceServer[]; expires: number; unlimitedSession?: boolean }>(id, token, { action: "claim", claimant }, session.controller.signal);
      if (!current()) return;
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } }, audio: audio ? { echoCancellation: true, noiseSuppression: true } : false });
      if (!current()) { stream.getTracks().forEach(track => track.stop()); return; }
      session.stream = stream;
      if (video.current) { video.current.srcObject = stream; void video.current.play().catch(() => {}); }
      if (!current()) return;
      const peer = new RTCPeerConnection({ iceServers: config.iceServers }); session.peer = peer;
      stream.getTracks().forEach(track => { peer.addTrack(track, stream); track.addEventListener("ended", () => fail("Your camera stopped. Scan a new code to reconnect."), { once: true }); });
      const channel = peer.createDataChannel("camera-control"); session.channel = channel;
      channel.onopen = () => {
        if (!current()) return;
        if (config.unlimitedSession) clearTimeout(session.expiry);
        setStatus("connected"); setNote("Your camera is visible on the computer."); session.lastPing = Date.now();
        session.heartbeat = setInterval(() => { if (Date.now() - session.lastPing > 12_000) fail("Your computer stopped responding. Scan a new code to reconnect."); }, 3000);
      };
      channel.onclose = () => fail("Your computer disconnected. Scan a new code to reconnect.");
      channel.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "ping") { session.lastPing = Date.now(); channel.send(JSON.stringify({ type: "pong" })); }
          if (message.type === "stop") stop("Your computer ended camera sharing.");
          if (message.type === "capture-request") void capture();
          if (message.type === "captured") { takingPhoto.current = false; if (capturePending.current) clearTimeout(capturePending.current); setNote("Photo received on your computer. You can take another."); }
          if (message.type === "capture-error") { takingPhoto.current = false; if (capturePending.current) clearTimeout(capturePending.current); setError("The computer could not capture that photo. Try again."); }
        } catch { /* Ignore malformed peer controls. */ }
      };
      peer.onconnectionstatechange = () => { if (peer.connectionState === "failed") fail("The video connection failed. Check your internet connection, then scan a new code."); };
      session.expiry = setTimeout(() => fail("This ten-minute connection ended. Scan a new code to continue."), config.expires - Date.now());
      void connectPeer(peer, { id, token, claimant, role: "phone", signal: session.controller.signal, isReady: () => channel.readyState === "open" })
        .catch(error => { if (!session.controller.signal.aborted) fail(error instanceof Error ? error.message : "Connection failed."); });
    } catch (error) { fail(error instanceof DOMException && error.name === "NotAllowedError" ? "Camera access was declined. Allow it in your browser, then scan a new code." : error instanceof Error ? error.message : "The camera could not start."); }
  }
  async function switchCamera() {
    const session = sessionRef.current;
    if (!session?.stream || !session.peer || switching) return;
    setSwitching(true); setError("");
    const next = facing === "user" ? "environment" : "user";
    // iOS often needs the old camera released before the opposite lens opens.
    session.stream.getVideoTracks().forEach(track => track.stop());
    let camera: MediaStream | null = null;
    try {
      camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: next }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (sessionRef.current !== session) { camera.getTracks().forEach(track => track.stop()); return; }
      const track = camera.getVideoTracks()[0];
      await session.peer.getSenders().find(sender => sender.track?.kind === "video")?.replaceTrack(track);
      if (sessionRef.current !== session) return;
      session.stream.getVideoTracks().forEach(old => session.stream!.removeTrack(old)); session.stream.addTrack(track);
      track.addEventListener("ended", () => { if (sessionRef.current === session) { stop(""); setError("Your camera stopped. Scan a new code to reconnect."); } }, { once: true });
      if (video.current) video.current.srcObject = new MediaStream(session.stream.getTracks());
      camera = null; // The active session now owns this camera track.
      setFacing(next);
    } catch { stop(""); setError("The camera could not switch. Scan a new code to reconnect."); }
    finally {
      // Disconnect can finish while replaceTrack is still pending.
      camera?.getTracks().forEach(track => track.stop());
      setSwitching(false);
    }
  }
  async function capture() {
    const session = sessionRef.current, channel = session?.channel;
    if (channel?.readyState !== "open" || !video.current || takingPhoto.current) return;
    takingPhoto.current = true;
    setError(""); setNote("Sending photo to your computer…");
    try {
      const photo = await frame(video.current);
      if (sessionRef.current !== session) return;
      await sendPhoto(channel, photo, crypto.randomUUID());
      if (capturePending.current) clearTimeout(capturePending.current);
      capturePending.current = setTimeout(() => { takingPhoto.current = false; setError("The computer did not confirm the photo. Keep both pages open and try again."); }, 8000);
    } catch (error) { takingPhoto.current = false; setError(error instanceof Error ? error.message : "Photo transfer failed."); }
  }
  return <main className="phone-capture">
    <h1>Your phone camera</h1>
    <p className="try-on-fine">Your camera appears on the computer for photos and live costume previews. Keep this page open.</p>
    <video ref={video} autoPlay playsInline muted aria-label="Your phone camera" />
    {status === "idle" && <><label><input type="checkbox" checked={audio} onChange={event => setAudio(event.target.checked)} />Share my phone microphone for GPT Live voice styling. OpenAI processes this audio when I start the stylist.</label><p className="try-on-fine">Opening the camera shares video with your paired computer. Live try-on sends it to Decart through fal after you start the mirror.</p><button className="btn btn-block" onClick={() => void start()}>Open camera</button></>}
    {status === "connecting" && <p role="status">Connecting to your computer…</p>}
    {status === "connected" && <div className="phone-camera-actions"><button className="btn" onClick={() => void capture()}>Take photo</button><button className="btn btn-ghost" onClick={() => void switchCamera()} disabled={switching}>{switching ? "Switching…" : "Switch camera"}</button></div>}
    {status !== "idle" && <button className="btn btn-ghost" onClick={() => stop()}>Stop sharing</button>}
    {note && <p role="status">{note}</p>}{error && <p className="try-on-error" role="alert">{error}</p>}
  </main>;
}
