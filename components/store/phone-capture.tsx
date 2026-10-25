"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { preparePhoto } from "@/lib/photo/prepare";
import "./virtual-try-on.css";

// Opened from the desktop QR code (/capture#<id>): the phone takes the photo and hands it over.
export function PhoneCapture() {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function send(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const id = location.hash.slice(1);
    setState("sending"); setError("");
    try {
      const photo = await preparePhoto(file);
      const response = await fetch(`/api/capture/${id}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: photo });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "The photo could not be sent. Try again.");
      setState("sent");
    } catch (caught) {
      setState("idle");
      setError(caught instanceof Error ? caught.message : "The photo could not be sent. Try again.");
    }
  }

  return <main className="phone-capture">
    <input ref={input} className="try-on-file" type="file" accept="image/*" capture="environment" onChange={send} tabIndex={-1} aria-hidden="true" />
    <h1>{state === "sent" ? "Sent. Check your computer." : "Take a full-body photo"}</h1>
    <p className="try-on-fine">{state === "sent" ? "Your photo is now on your computer screen. You can close this page." : "Stand back so your whole body is in the frame, with just you in the photo."}</p>
    <button type="button" className="btn btn-block try-on-primary" onClick={() => input.current?.click()} disabled={state === "sending"}>
      {state === "sending" ? "Sending…" : state === "sent" ? "Take another photo" : "Open camera"}
    </button>
    {error && <p className="try-on-error" role="alert">{error}</p>}
  </main>;
}
