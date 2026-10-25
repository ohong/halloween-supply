"use client";
import { useEffect, useState } from "react";
import { Mic } from "lucide-react";
import type { CostumeView } from "@/lib/types";
import type { MirrorCatalogContext, MirrorOutfit } from "@/lib/live-mirror/types";
import { applyActions } from "@/lib/live-mirror/state";
import { useLiveVoice } from "@/lib/live-mirror/use-live-voice";
import { usePhoneCamera } from "./phone-camera";

export function PhotoVoiceStylist({ costume, outfit, onApply }: { costume: CostumeView; outfit: MirrorOutfit; onApply: (outfit: MirrorOutfit, costume?: CostumeView) => void }) {
  const phone = usePhoneCamera();
  const [locked, setLocked] = useState<string[]>([]);
  const [transcript, setTranscript] = useState("");
  const currentOutfit = { ...outfit, locked };
  const [catalogContext, setCatalogContext] = useState<MirrorCatalogContext>();
  const [notice, setNotice] = useState("");
  const voice = useLiveVoice({ costume, outfit: currentOutfit, catalogContext, microphone: phone.status === "connected" ? phone.stream : null,
    onVisualFeedback: async () => { throw new Error("Open the live costume mirror and start a preview to ask for visual feedback."); },
    onTranscript: text => setTranscript(text),
    onCommand: async command => {
      if (command.catalogResults) setCatalogContext({ query: command.catalogResults.query, matches: command.catalogResults.matches.map(({ costumeSlug, pieceId, productId }) => ({ costumeSlug, pieceId, productId })) });
      const mixes = command.actions.filter(action => action.type === "mix");
      let nextCostume = costume;
      let nextOutfit = currentOutfit;
      if (mixes.length) {
        const response = await fetch("/api/live-mirror/mix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ costumeSlug: costume.costume.slug, outfit: currentOutfit, actions: mixes }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "That piece could not be added.");
        nextCostume = result.costume; nextOutfit = result.outfit;
      }
      const edits = command.actions.filter(action => !["mix", "try_look", "freeze", "resume", "save", "undo"].includes(action.type));
      if (edits.length || mixes.length) { const next = applyActions(nextCostume, nextOutfit, edits).outfit; setLocked(next.locked); onApply(next, nextCostume); }
      setNotice(command.catalogResults && !command.actions.length ? command.message ?? "" : edits.length || mixes.length ? "Pieces updated. Tap Try it on to generate a new photo preview." : "Choose pieces by voice. Use the photo controls to generate or save a preview.");
    },
  });
  const stop = voice.stop;
  useEffect(() => { if (phone.mode === "live") stop(); }, [phone.mode, stop]);
  useEffect(() => { return () => stop(); }, [phone.stream, stop]);
  const live = voice.status === "live";
  return <section className="try-on-option" aria-label="Photo voice styling">
    <span className="try-on-option-icon" aria-hidden="true"><Mic size={18} /></span>
    <div><p>Voice stylist</p><p className="try-on-option-hint">Say “choose the cheapest jacket” to swap pieces.</p></div>
    {live ? <button className="btn btn-ghost btn-small" onClick={voice.stop}>Stop</button>
      : <button className="btn btn-ghost btn-small" aria-label="Start photo voice styling" disabled={voice.status === "connecting" || phone.mode === "live"} onClick={() => void voice.start()}>{voice.status === "connecting" ? "Connecting…" : "Start"}</button>}
    {!live && <p className="try-on-option-note">Starting sends {phone.stream?.getAudioTracks().length ? "your phone microphone" : "this device’s microphone"} audio to OpenAI.</p>}
    {transcript && <p className="try-on-option-note">{transcript}</p>}
    {notice && <p role="status" className="try-on-option-note">{notice}</p>}
    {voice.error && <p role="alert" className="try-on-error">{voice.error}</p>}
  </section>;
}
