"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { preparePhoto } from "@/lib/photo/prepare";
import { renderSVG } from "uqr";
import { connectionError, connectPeer, pairRequest, stageLabel, watchConnection, type ConnectionStage, type IceConfiguration, type Pair } from "@/lib/phone-camera/connection";
import "./phone-camera.css";

type Connection = { pair: Pair; peer: RTCPeerConnection; controller: AbortController; channel?: RTCDataChannel; heartbeat?: ReturnType<typeof setInterval>; expiry?: ReturnType<typeof setTimeout>; lastPing: number; incoming?: { id: string; size: number; received: number; chunks: ArrayBuffer[] }; pendingCapture?: { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } };
type Camera = {
  mode: "photo" | "live"; setMode: (mode: "photo" | "live") => void;
  stream: MediaStream | null; photo: { blob: Blob; id: string } | null;
  status: "idle" | "waiting" | "connecting" | "connected"; stage: ConnectionStage; relayAvailable: boolean; relayWarning: string; error: string; url: string;
  connect: () => Promise<void>; disconnect: () => void; capture: () => Promise<void>;
};
const CameraContext = createContext<Camera | null>(null);
export function usePhoneCamera() { const value = useContext(CameraContext); if (!value) throw new Error("Phone camera provider is missing."); return value; }
function release(session: Connection) {
  if (session.channel?.readyState === "open") session.channel.send(JSON.stringify({ type: "stop" }));
  if (session.pendingCapture) { clearTimeout(session.pendingCapture.timer); session.pendingCapture.reject(new Error("Phone disconnected.")); }
  session.controller.abort(); clearTimeout(session.expiry); clearInterval(session.heartbeat);
  if (session.channel) { session.channel.onmessage = null; session.channel.onopen = null; session.channel.onclose = null; }
  session.peer.ontrack = null; session.peer.ondatachannel = null;
  session.peer.getReceivers().forEach(receiver => receiver.track?.stop()); session.peer.close();
  void fetch(`/api/camera-pair/${session.pair.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${session.pair.host}` }, keepalive: true }).catch(() => {});
}
export function PhoneCameraProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<"photo" | "live">("photo");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [photo, setPhoto] = useState<Camera["photo"]>(null);
  const [status, setStatus] = useState<Camera["status"]>("idle");
  const [error, setError] = useState("");
  const [relayAvailable, setRelayAvailable] = useState(false);
  const [relayWarning, setRelayWarning] = useState("");
  const [stage, setStage] = useState<ConnectionStage>("pairing");
  const [url, setUrl] = useState("");
  const sessionRef = useRef<Connection | null>(null);
  const generation = useRef(0);
  const setupRef = useRef<{ controller: AbortController; pair?: Pair } | null>(null);
  const capture = useCallback(async () => {
    const session = sessionRef.current;
    if (session?.channel?.readyState !== "open") throw new Error("Connect your phone first.");
    if (session.pendingCapture) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { session.pendingCapture = undefined; reject(new Error("The phone did not send a photo. Keep its camera page open and try again.")); }, 20_000);
      session.pendingCapture = { resolve, reject, timer };
      session.channel!.send(JSON.stringify({ type: "capture-request" }));
    });
  }, []);
  const disconnect = useCallback(() => {
    generation.current++;
    const setup = setupRef.current; setupRef.current = null;
    if (setup) {
      setup.controller.abort();
      if (setup.pair) void fetch(`/api/camera-pair/${setup.pair.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${setup.pair.host}` }, keepalive: true }).catch(() => {});
    }
    const session = sessionRef.current; sessionRef.current = null;
    if (session) release(session);
    setStream(null); setStatus("idle"); setUrl(""); setRelayWarning("");
  }, []);
  const connect = useCallback(async () => {
    disconnect(); setError(""); setStatus("connecting"); setStage("pairing"); setRelayAvailable(false);
    const version = generation.current;
    const controller = new AbortController();
    const setup: { controller: AbortController; pair?: Pair } = { controller }; setupRef.current = setup;
    let currentStage: ConnectionStage = "pairing";
    try {
      const response = await fetch("/api/camera-pair", { method: "POST", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) });
      if (!response.ok) throw new Error("Could not create a phone connection. Please try again.");
      const pair = await response.json() as Pair;
      setup.pair = pair;
      if (generation.current !== version) { void fetch(`/api/camera-pair/${pair.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${pair.host}` } }).catch(() => {}); return; }
      currentStage = "relay"; setStage(currentStage);
      const config = await pairRequest<IceConfiguration>(pair.id, pair.host, { action: "claim", claimant: crypto.randomUUID() }, controller.signal);
      if (generation.current !== version) return;
      setRelayAvailable(config.relayAvailable);
      if (config.relayStatus === "unavailable") setRelayWarning("The network relay is unavailable. Trying a direct connection; keep both devices on the same Wi-Fi.");
      const peer = new RTCPeerConnection({ iceServers: config.iceServers });
      const session: Connection = { pair, peer, controller, lastPing: Date.now() }; sessionRef.current = session;
      setupRef.current = null;
      const fail = (message: string) => { if (sessionRef.current !== session) return; disconnect(); setError(message); };
      session.expiry = setTimeout(() => fail("Your ten-minute phone connection ended. Connect again to continue."), pair.expires - Date.now());
      setUrl(`${location.origin}/capture#${pair.id}.${pair.phone}`); setStatus("waiting");
      const remote = new MediaStream();
      peer.ontrack = event => { if (sessionRef.current !== session) { event.track.stop(); return; } remote.addTrack(event.track); setStream(remote); };
      watchConnection(peer, { signal: controller.signal,
        onRecovering: () => { session.lastPing = Date.now(); setStage("reconnecting"); setStatus("connecting"); },
        onRecovered: () => { session.lastPing = Date.now(); if (session.channel?.readyState === "open") { setStage("connected"); setStatus("connected"); } },
        onFailed: () => fail(session.heartbeat ? "Your phone disconnected. Use phone camera to create a new code." : config.relayAvailable ? "Your phone could not reach this computer. Try again, or switch the phone to Wi-Fi." : "Your phone could not reach this computer. Put both devices on the same Wi-Fi network and try again."),
      });
      peer.ondatachannel = event => {
        if (sessionRef.current !== session) { event.channel.close(); return; }
        const channel = event.channel; channel.binaryType = "arraybuffer"; session.channel = channel;
        channel.onopen = () => {
          if (sessionRef.current !== session) return;
          // The one-use link still expires; an established demo stream does not.
          if (pair.unlimitedSession) clearTimeout(session.expiry);
          setStatus("connected"); setStage("connected"); setUrl(""); session.lastPing = Date.now();
          session.heartbeat = setInterval(() => {
            if (Date.now() - session.lastPing > 12_000) { fail("Your phone stopped responding. Keep its camera page open and connect again."); return; }
            if (channel.readyState === "open") channel.send(JSON.stringify({ type: "ping" }));
          }, 3000);
        };
        channel.onclose = () => fail("Your phone disconnected. Connect it again to continue.");
        channel.onmessage = async event => {
          try {
            if (event.data instanceof ArrayBuffer) {
              const incoming = session.incoming;
              if (!incoming || incoming.received + event.data.byteLength > incoming.size) throw new Error("Invalid photo transfer.");
              incoming.received += event.data.byteLength; incoming.chunks.push(event.data); return;
            }
            const message = JSON.parse(event.data);
            if (message.type === "pong") session.lastPing = Date.now();
            if (message.type === "stop") { fail("Your phone stopped sharing its camera."); return; }
            if (message.type === "photo-start") {
              if (!Number.isInteger(message.size) || message.size < 1 || message.size > 3 * 1024 * 1024 || typeof message.id !== "string" || message.id.length > 50) throw new Error("Invalid photo transfer.");
              session.incoming = { id: message.id, size: message.size, received: 0, chunks: [] };
            }
            if (message.type === "photo-end") {
              const incoming = session.incoming; session.incoming = undefined;
              if (!incoming || incoming.id !== message.id || incoming.received !== incoming.size) throw new Error("Incomplete photo.");
              const blob = await preparePhoto(new Blob(incoming.chunks, { type: "image/jpeg" }));
              if (sessionRef.current !== session) return;
              setPhoto({ blob, id: incoming.id });
              if (session.pendingCapture) { clearTimeout(session.pendingCapture.timer); session.pendingCapture.resolve(); session.pendingCapture = undefined; }
              if (channel.readyState === "open") channel.send(JSON.stringify({ type: "captured", id: incoming.id }));
            }
          } catch {
            session.incoming = undefined;
            if (session.pendingCapture) { clearTimeout(session.pendingCapture.timer); session.pendingCapture.reject(new Error("The photo could not be received. Try again.")); session.pendingCapture = undefined; }
            if (channel.readyState === "open") channel.send(JSON.stringify({ type: "capture-error" }));
          }
        };
      };
      void connectPeer(peer, { id: pair.id, token: pair.host, role: "host", signal: controller.signal, isReady: () => session.channel?.readyState === "open", onRemote: () => setStatus("connecting"), onStage: next => { currentStage = next; if (session.channel?.readyState !== "open") setStage(next); } })
        .catch(error => { if (!controller.signal.aborted) fail(connectionError(error, currentStage)); });
    } catch (error) { if (generation.current === version) { disconnect(); setError(connectionError(error, currentStage)); } }
  }, [disconnect]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) disconnect(); };
    window.addEventListener("pagehide", disconnect); document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("pagehide", disconnect); document.removeEventListener("visibilitychange", hidden); disconnect(); };
  }, [disconnect]);
  return <CameraContext.Provider value={{ mode, setMode, stream, photo, status, stage, relayAvailable, relayWarning, error, url, connect, disconnect, capture }}>{children}</CameraContext.Provider>;
}
export function PhoneCameraControls({ compact = false, showPreview = true }: { compact?: boolean; showPreview?: boolean }) {
  const phone = usePhoneCamera();
  const video = useRef<HTMLVideoElement>(null);
  const [captureError, setCaptureError] = useState("");
  useEffect(() => { if (video.current) video.current.srcObject = phone.stream; }, [phone.stream, showPreview]);
  // Outside the mirror, "Take photo" starts the pairing, so an idle panel would only repeat it.
  if (!compact && phone.status === "idle" && !phone.error && !captureError) return null;
  return <section className={`phone-camera-controls${compact ? " is-compact" : ""}`} aria-label="Phone camera connection">
    {phone.stream && showPreview && <video ref={video} autoPlay playsInline muted aria-label="Phone camera preview" />}
    {phone.status === "idle" ? <button type="button" className="btn btn-ghost" onClick={() => { setCaptureError(""); void phone.connect(); }}>Use phone camera</button> : <>
      <p role="status" data-connection-stage={phone.stage}>{phone.status === "waiting" ? "Scan with your phone" : stageLabel[phone.stage]}</p>
      {phone.url && <><div className="phone-camera-qr" dangerouslySetInnerHTML={{ __html: renderSVG(phone.url, { border: 2 }) }} /><a href={phone.url} target="_blank" rel="noreferrer">Open phone camera link</a><p className="try-on-fine">Keep this code private. It expires in ten minutes. Open your camera on the phone to share its view here. {!phone.relayAvailable && "Use the same Wi-Fi network on both devices. Some networks may block direct connections."}</p></>}
      {phone.relayWarning && <p className="try-on-fine" role="status">{phone.relayWarning}</p>}
      <div className="phone-camera-actions">{phone.status === "connected" && !compact && <button className="btn" onClick={() => void phone.capture().then(() => setCaptureError("")).catch(error => setCaptureError(error.message))}>Take photo from phone</button>}<button className="btn btn-ghost" onClick={phone.disconnect}>{phone.status === "connected" ? "Disconnect phone" : "Cancel phone connection"}</button></div>
    </>}
    {(phone.error || captureError) && <p role="alert" className="try-on-error">{phone.error || captureError}</p>}
  </section>;
}
