export type Pair = { id: string; host: string; phone: string; expires: number; relayAvailable: boolean; unlimitedSession?: boolean };
export async function pairRequest<T>(id: string, token: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/camera-pair/${id}`, {
    method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "The phone could not connect. Try a new QR code.");
  return data;
}
/** Exchange candidates as they arrive: relay discovery can finish after the SDP. */
export async function connectPeer(peer: RTCPeerConnection, options: {
  id: string; token: string; claimant?: string; role: "host" | "phone";
  signal: AbortSignal; isReady: () => boolean; onRemote?: () => void;
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
      }
      if (peer.remoteDescription) {
        for (const candidate of (remote.candidates ?? []).slice(received)) {
          await peer.addIceCandidate(candidate); received++;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
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
