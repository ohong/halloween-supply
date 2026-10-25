export type Pair = { id: string; host: string; phone: string; expires: number; relayAvailable: boolean };
export async function pairRequest<T>(id: string, token: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/camera-pair/${id}`, {
    method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "The phone could not connect. Try a new QR code.");
  return data;
}
export async function gather(peer: RTCPeerConnection, signal: AbortSignal) {
  if (peer.iceGatheringState === "complete") return;
  await new Promise<void>((resolve, reject) => {
    const finish = () => { clearTimeout(timer); peer.removeEventListener("icegatheringstatechange", check); signal.removeEventListener("abort", abort); resolve(); };
    const check = () => { if (peer.iceGatheringState === "complete") finish(); };
    const abort = () => { finish(); reject(new Error("Connection cancelled.")); };
    // SDP contains candidates gathered so far, including TURN. No trickle endpoint needed.
    const timer = setTimeout(finish, 6000);
    peer.addEventListener("icegatheringstatechange", check); signal.addEventListener("abort", abort, { once: true }); check();
  });
  if (signal.aborted) throw new Error("Connection cancelled.");
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
