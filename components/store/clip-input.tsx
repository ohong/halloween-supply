"use client";

import { useEffect, useRef, useState } from "react";
import "./clip-input.css";

const MAX_CLIP = 4 * 1024 * 1024;
const MAX_FRAME = 200 * 1024;
const TYPES = ["video/mp4", "video/webm", "video/quicktime"];

async function captureFrame(video: HTMLVideoElement) {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) throw new Error("Wait for the clip to load, then choose a clear frame.");
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 900 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not capture a frame. Try another browser.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const frame = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The frame could not be captured.")), "image/jpeg", 0.75));
  if (frame.size > MAX_FRAME) throw new Error("This frame is too detailed to upload. Try a smaller clip.");
  return frame;
}

/** The caller owns the preview URL after submission and consumes the normal sourcing event stream. */
export function ClipInput({ disabled = false, onSubmit }: {
  disabled?: boolean;
  onSubmit: (form: FormData, preview: string | null) => void | Promise<void>;
}) {
  const [enabled, setEnabled] = useState(false);
  const [youtube, setYoutube] = useState("");
  const [clip, setClip] = useState<{ file: File; url: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const busy = disabled || preparing;

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/clip-costume", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]) })
      .then(response => response.ok ? response.json() : null)
      .then(body => { if (!controller.signal.aborted) setEnabled(body?.enabled === true); }).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.url); }, [clip]);

  if (!enabled) return null;

  function choose(file: File) {
    if (!TYPES.includes(file.type)) { setError("Use an MP4, WebM or MOV clip."); return; }
    if (file.size > MAX_CLIP) { setError("That clip is over 4 MB. Trim it to a few seconds and try again."); return; }
    if (!file.size) { setError("This clip is empty. Choose another file."); return; }
    setReady(false); setError(null);
    setClip({ file, url: URL.createObjectURL(file) });
  }

  async function submit() {
    setError(null); setPreparing(true);
    let preview: string | null = null;
    try {
      const form = new FormData();
      if (clip) {
        if (!video.current) throw new Error("Choose the clip again.");
        video.current.pause();
        const frame = await captureFrame(video.current);
        preview = URL.createObjectURL(frame);
        form.set("clip", clip.file, clip.file.name);
        form.set("frame", frame, "reference.jpg");
      } else {
        if (!youtube.trim()) throw new Error("Choose a clip or paste a YouTube link.");
        form.set("youtube", youtube.trim());
      }
      await onSubmit(form, preview);
    } catch (caught) {
      if (preview) URL.revokeObjectURL(preview);
      setError(caught instanceof Error ? caught.message : "The clip could not be prepared. Please try again.");
    } finally { setPreparing(false); }
  }

  return <details className="clip-input">
    <summary>Find a look from a clip</summary>
    <div className="clip-input-body">
      <p className="meta">We read the visible outfit and audio context. Reading a clip can take up to 90 seconds.</p>
      <label className="clip-input-link">
        <span className="meta">Public YouTube link</span>
        <input type="url" inputMode="url" value={youtube} placeholder="https://youtube.com/watch?v=…" disabled={busy || !!clip}
          onChange={event => { setYoutube(event.target.value); setError(null); }} />
      </label>
      <p className="meta">or upload an MP4, WebM or MOV under 4 MB</p>
      <input ref={input} className="clip-input-file" type="file" accept="video/mp4,video/webm,video/quicktime" disabled={busy || !!youtube.trim()}
        aria-label="Choose a clip" onChange={event => { const file = event.target.files?.[0]; if (file) choose(file); event.target.value = ""; }} />
      {clip && <>
        <video ref={video} src={clip.url} controls muted playsInline preload="metadata"
          onLoadedData={() => setReady(true)} onError={() => { setReady(false); setError("This clip cannot play in your browser. Try an MP4."); }} />
        <p className="meta">Pause on a frame that clearly shows the outfit. We compare product photos against that frame.</p>
        <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={() => { setClip(null); setReady(false); setError(null); }}>Remove clip</button>
      </>}
      {!clip && youtube.trim() && <p className="meta">YouTube results are shop links. Upload a clip to compare product photos against a chosen frame.</p>}
      <button type="button" className="btn btn-block" disabled={busy || (clip ? !ready : !youtube.trim())} onClick={() => void submit()}>
        {preparing ? "Preparing clip…" : disabled ? "Reading the look…" : "Find the clip’s look"}
      </button>
      {error && <p className="notice" role="alert">{error}</p>}
    </div>
  </details>;
}
