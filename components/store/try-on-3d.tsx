"use client";
/* eslint-disable @next/next/no-img-element */
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { FocusPiece, RenderOffer, RenderStatus } from "@/lib/try-on-3d/types";
import "./try-on-3d.css";
const CostumeModel = dynamic(() => import("./costume-model"), { ssr: false, loading: () => <p role="status">Opening the 3D viewer…</p> });
type Job = { phase: "idle" } | { phase: "submitting" } | { phase: "waiting"; token: string; status: "queued" | "processing"; progress?: number } | { phase: "ready"; url: string } | { phase: "error"; message: string; token?: string };

export function TryOn3D({ image, offer, pieces }: { image: string; offer: RenderOffer | null; pieces: FocusPiece[] }) {
  const [job, setJob] = useState<Job>({ phase: "idle" });
  const [view, setView] = useState<"photo" | "3d">("3d");
  const [polling, setPolling] = useState(true);
  const [notice, setNotice] = useState("");
  const busy = useRef(false);
  const submitController = useRef<AbortController | null>(null);
  useEffect(() => () => submitController.current?.abort(), []);
  const token = job.phase === "waiting" ? job.token : null;
  useEffect(() => {
    if (!token || !polling) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const started = Date.now();
    async function poll() {
      try {
        const response = await fetch("/api/try-on/3d/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), signal: controller.signal });
        const result = await response.json();
        if (!response.ok) {
          if ([400, 403, 410, 422].includes(response.status)) { setJob({ phase: "error", message: result.error || "This preview is unavailable." }); return; }
          throw new Error("Connection interrupted");
        }
        if (controller.signal.aborted) return;
        failures = 0; setNotice("");
        const status = result as RenderStatus;
        if (status.status === "ready") { setJob({ phase: "ready", url: status.modelUrl }); return; }
        if (status.status === "failed") { setJob({ phase: "error", message: status.error }); return; }
        if (status.status !== "queued" && status.status !== "processing") throw new Error("Unreadable status");
        setJob({ phase: "waiting", token: token!, ...status });
      } catch {
        if (controller.signal.aborted) return;
        failures++;
        setNotice("Connection interrupted. We’ll check the same model again; no new generation is started.");
        if (failures >= 6) { setJob({ phase: "error", token: token!, message: "We could not check the model. You can reconnect to the same generation." }); return; }
      }
      if (Date.now() - started >= 60 * 60_000) { setPolling(false); setNotice("This model is taking longer than usual. Check again later without creating another generation."); return; }
      timer = setTimeout(poll, document.hidden ? 20_000 : Math.min(30_000, 5000 * Math.max(1, failures)));
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, polling]);

  async function generate() {
    if (!offer || busy.current) return;
    busy.current = true;
    const controller = new AbortController(); submitController.current = controller;
    setJob({ phase: "submitting" }); setNotice(""); setPolling(true);
    try {
      const response = await fetch("/api/try-on/3d", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image, ticket: offer.ticket, consent: true }), signal: controller.signal });
      const data = await response.json();
      if (!response.ok || typeof data.token !== "string") throw new Error(data.error || "The 3D model could not be started.");
      if (!controller.signal.aborted) setJob({ phase: "waiting", token: data.token, status: "queued" });
    } catch (caught) { if (!controller.signal.aborted) setJob({ phase: "error", message: caught instanceof Error ? caught.message : "The model could not be started." }); }
    finally { busy.current = false; }
  }
  return <section className="try-on-3d" aria-label="See your costume in 3D">
    <header><div><span className="try-on-3d-eyebrow">A DIFFERENT PERSPECTIVE</span><h3>Your costume. Every angle.</h3></div><span className="try-on-3d-mark" aria-hidden="true">↗</span></header>
    {job.phase === "ready" ? <>
      <div className="try-on-3d-tabs" role="group" aria-label="Preview view"><button type="button" aria-pressed={view === "3d"} onClick={() => setView("3d")}>3D look</button><button type="button" aria-pressed={view === "photo"} onClick={() => setView("photo")}>Photo</button><a href={job.url} target="_blank" rel="noopener noreferrer" download="costume.glb">Download 3D ↗</a></div>
      {view === "3d" ? <CostumeModel url={job.url} pieces={pieces} /> : <img className="try-on-3d-photo" src={image} alt="Your costume photo preview" />}
    </> : job.phase === "waiting" || job.phase === "submitting" ? <div className="try-on-3d-progress">
      <div className="try-on-3d-wait-image"><img src={image} alt="Your costume preview while the 3D model is created" /></div>
      <p role="status">{job.phase === "submitting" ? "Sending your costume preview…" : job.status === "queued" ? "Your 3D look is in the queue." : "Building your shape and textures…"}</p>
      {job.phase === "waiting" && job.progress !== undefined && <progress max={100} value={job.progress} aria-label="3D generation progress" />}
      <p>This can take several minutes. You can keep exploring this page.</p>
      {job.phase === "waiting" && <button type="button" onClick={() => setPolling(!polling)}>{polling ? "Pause updates" : "Check progress"}</button>}
      <small>Leaving this page removes the preview here. Generation may continue at the provider.</small>
    </div> : job.phase === "error" ? <div className="try-on-3d-error" role="alert"><p>{job.message}</p>{job.token ? <button type="button" onClick={() => { setPolling(true); setJob({ phase: "waiting", token: job.token!, status: "processing" }); }}>Reconnect</button> : <button type="button" onClick={generate}>Try again</button>}</div> : <>
      <p>Turn your photo preview into a 3D look. Rotate it, then select a piece to see it up close.</p>
      <button type="button" className="btn btn-block" onClick={generate} disabled={!offer}>Create my 3D look <span aria-hidden="true">↗</span></button>
      <p className="try-on-3d-privacy">{offer ? `Tapping sends this costume preview to ${offer.label}. This app keeps your preview in this page’s memory only. The provider processes and retains it under its own policies.` : "3D generation is not configured yet. Your photo preview is ready to use."}</p>
    </>}
    {notice && <p role="status" className="try-on-3d-privacy">{notice}</p>}
  </section>;
}
