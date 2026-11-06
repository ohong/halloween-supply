export type Pair = { id: string; host: string; phone: string; expires: number; unlimitedSession?: boolean };
export type IceConfiguration = { iceServers: RTCIceServer[]; expires: number; unlimitedSession?: boolean; relayAvailable: boolean; relayProvider: "metered" | null; relayStatus: "ready" | "unconfigured" | "unavailable" };
export type ConnectionStage = "pairing" | "relay" | "camera" | "signaling" | "network" | "connected" | "reconnecting";
export const stageLabel: Record<ConnectionStage, string> = {
  pairing: "Creating phone connection…", relay: "Preparing network connection…", camera: "Waiting for camera permission…",
  signaling: "Exchanging connection details…", network: "Connecting video…", connected: "Phone camera connected", reconnecting: "Reconnecting phone…",
};
export function connectionError(error: unknown, stage: ConnectionStage) {
  if (error instanceof DOMException && error.name === "NotAllowedError") return "Camera access was declined. Allow it in your browser, then scan a new code.";
  if (error instanceof DOMException && error.name === "NotFoundError") return "No camera was found. Use a phone with a camera, then scan a new code.";
  if (error instanceof DOMException && error.name === "NotReadableError") return "Another app may be using your camera. Close it, then scan a new code.";
  if (error instanceof Error && error.name !== "TimeoutError" && error.name !== "TypeError") return error.message;
  const messages: Partial<Record<ConnectionStage, string>> = {
    pairing: "The connection service did not respond. Check your internet connection and try again.",
    relay: "Network setup did not respond. Check your internet connection and scan a new code.",
    signaling: "Connection details could not be exchanged. Keep both pages open and scan a new code.",
    network: "The devices could not connect. Put both devices on the same Wi-Fi network and scan a new code.",
    camera: "The camera did not start. Allow camera access, then scan a new code.",
  };
  return messages[stage] ?? "The phone disconnected. Scan a new code to reconnect.";
}
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const finish = () => { signal.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
  });
}
export async function pairRequest<T>(id: string, token: string, body?: object, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(12_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(`/api/camera-pair/${id}`, {
        method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: requestSignal,
      });
    } catch (error) {
      if (requestSignal.aborted || attempt >= 2) throw error;
      await pause(400 * (attempt + 1), requestSignal); continue;
    }
    if ([429, 502, 503, 504].includes(response.status) && attempt < 2) {
      await response.body?.cancel(); await pause(400 * (attempt + 1), requestSignal); continue;
    }
    const data = await response.json().catch(() => { throw new Error("The connection service returned unreadable data. Scan a new code."); });
    if (!response.ok) throw new Error(data.error ?? "The phone could not connect. Try a new QR code.");
    return data;
  }
}
/** Permission prompts cannot be canceled. Release any camera granted after stop or timeout. */
export async function openCamera(constraints: MediaStreamConstraints, signal: AbortSignal) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Open this page in Safari or Chrome over HTTPS to use your camera.");
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  deadline.throwIfAborted();
  const pending = navigator.mediaDevices.getUserMedia(constraints);
  return new Promise<MediaStream>((resolve, reject) => {
    const abort = () => reject(new Error(signal.aborted ? "Camera sharing stopped." : "Camera permission timed out. Allow camera access, then scan a new code."));
    deadline.addEventListener("abort", abort, { once: true });
    pending.then(stream => {
      deadline.removeEventListener("abort", abort);
      if (deadline.aborted) { stream.getTracks().forEach(track => track.stop()); return; }
      resolve(stream);
    }, error => { deadline.removeEventListener("abort", abort); reject(error); });
  });
}
/** Let WebRTC recover brief network changes without closing healthy media tracks. */
export function watchConnection(peer: RTCPeerConnection, options: {
  signal: AbortSignal; onRecovering: () => void; onRecovered: () => void; onFailed: () => void;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let recovering = false;
  const changed = () => {
    if (options.signal.aborted) return;
    if (peer.connectionState === "connected") {
      clearTimeout(timer); timer = undefined;
      if (recovering) { recovering = false; options.onRecovered(); }
    } else if (peer.connectionState === "disconnected" || peer.connectionState === "failed") {
      if (timer) return;
      recovering = true; options.onRecovering();
      timer = setTimeout(() => { timer = undefined; options.onFailed(); }, 12_000);
    }
  };
  const cleanup = () => { clearTimeout(timer); peer.removeEventListener("connectionstatechange", changed); };
  peer.addEventListener("connectionstatechange", changed);
  options.signal.addEventListener("abort", cleanup, { once: true });
}
/** Exchange candidates as they arrive: relay discovery can finish after the SDP. */
export async function connectPeer(peer: RTCPeerConnection, options: {
  id: string; token: string; claimant?: string; role: "host" | "phone";
  signal: AbortSignal; isReady: () => boolean; onRemote?: () => void; onStage?: (stage: ConnectionStage) => void;
}) {
  const { id, token, claimant, role, signal } = options;
  const candidates: RTCIceCandidateInit[] = [];
  let sent = 0, received = 0;
  const collect = (event: RTCPeerConnectionIceEvent) => {
    if (event.candidate && candidates.length < 128) candidates.push(event.candidate.toJSON());
  };
  peer.addEventListener("icecandidate", collect);
  const publish = async () => {
    const description = role === "phone" ? await peer.createOffer() : await peer.createAnswer();
    await peer.setLocalDescription(description);
    await pairRequest(id, token, { action: "signal", description, claimant }, signal);
  };
  try {
    options.onStage?.("signaling");
    if (role === "phone") await publish();
    // A host can wait for the QR scan until its pairing link expires.
    let deadline = role === "phone" ? Date.now() + 60_000 : Infinity;
    while (!signal.aborted && !options.isReady()) {
      if (Date.now() > deadline) throw new Error("The devices could not connect. Keep both pages open and scan a new code.");
      if (candidates.length > sent) {
        const snapshot = candidates.slice();
        await pairRequest(id, token, { action: "candidates", candidates: snapshot, claimant }, signal);
        sent = snapshot.length;
      }
      const remote = await pairRequest<{ description: RTCSessionDescriptionInit | null; candidates?: RTCIceCandidateInit[] }>(id, token, undefined, signal);
      if (signal.aborted) return;
      if (remote.description && !peer.remoteDescription) {
        options.onRemote?.();
        await peer.setRemoteDescription(remote.description);
        if (role === "host") { deadline = Date.now() + 60_000; await publish(); }
        options.onStage?.("network");
      }
      if (peer.remoteDescription) {
        for (const candidate of (remote.candidates ?? []).slice(received)) {
          await peer.addIceCandidate(candidate); received++;
        }
      }
      await pause(500, signal);
    }
  } finally { peer.removeEventListener("icecandidate", collect); }
}
export async function frame(video: HTMLVideoElement): Promise<Blob> {
  // WebRTC can start with tiny frames while bandwidth estimation warms up.
  // Do not acknowledge a photo that the try-on pipeline will reject.
  const deadline = Date.now() + 6000;
  while ((Math.min(video.videoWidth, video.videoHeight) < 256 || video.readyState < 2) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  if (Math.min(video.videoWidth, video.videoHeight) < 256 || video.readyState < 2) throw new Error("The camera is still warming up. Wait a moment and take another photo.");
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot capture a photo.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Photo capture failed.")), "image/jpeg", 0.9));
}

/** Ordered WebRTC chunks keep full-resolution photos out of the signaling store. */
export async function sendPhoto(channel: RTCDataChannel, blob: Blob, id: string) {
  if (blob.size > 3 * 1024 * 1024) throw new Error("This photo is too large.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  channel.send(JSON.stringify({ type: "photo-start", id, size: bytes.byteLength }));
  const deadline = Date.now() + 12_000;
  for (let offset = 0; offset < bytes.length; offset += 16_384) {
    while (channel.bufferedAmount > 65_536) {
      if (channel.readyState !== "open" || Date.now() > deadline) throw new Error("Photo transfer stopped. Try again.");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    channel.send(bytes.slice(offset, offset + 16_384));
  }
  channel.send(JSON.stringify({ type: "photo-end", id }));
}
