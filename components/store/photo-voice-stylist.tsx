"use client";
import { useEffect, useState } from "react";
import type { CostumeView } from "@/lib/types";
import type { MirrorOutfit } from "@/lib/live-mirror/types";
import { applyActions } from "@/lib/live-mirror/state";
import { useLiveVoice } from "@/lib/live-mirror/use-live-voice";
import { usePhoneCamera } from "./phone-camera";

export function PhotoVoiceStylist({ costume, outfit, onApply }: { costume: CostumeView; outfit: MirrorOutfit; onApply: (outfit: MirrorOutfit) => void }) {
  const phone = usePhoneCamera();
  const [consent, setConsent] = useState(false);
  const [locked, setLocked] = useState<string[]>([]);
  const [transcript, setTranscript] = useState("");
  const currentOutfit = { ...outfit, locked };
  const [notice, setNotice] = useState("");
  const voice = useLiveVoice({ costume, outfit: currentOutfit, microphone: phone.status === "connected" ? phone.stream : null,
    onTranscript: text => setTranscript(text),
    onCommand: command => {
      const edits = command.actions.filter(action => !["try_look", "freeze", "resume", "save", "undo"].includes(action.type));
      if (edits.length) { const next = applyActions(costume, currentOutfit, edits).outfit; setLocked(next.locked); onApply(next); }
      setNotice(edits.length ? "Pieces updated. Tap Try it on to generate a new photo preview." : "Choose pieces by voice. Use the photo controls to generate or save a preview.");
    },
  });
  const stop = voice.stop;
  useEffect(() => { if (phone.mode === "live") stop(); }, [phone.mode, stop]);
  useEffect(() => { return () => stop(); }, [phone.stream, stop]);
  return <section className="phone-camera-controls" aria-label="Photo voice styling">
    <p>Style your photo with GPT Live</p>
    {voice.status === "live" ? <button className="btn btn-ghost" onClick={voice.stop}>Stop voice styling</button> : <>
      <label className="mirror-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />Allow OpenAI to process my microphone audio for voice styling.</label>
      <p className="try-on-fine">{phone.stream?.getAudioTracks().length ? "Uses your phone microphone." : "Uses this device’s microphone."} Try “choose the cheapest jacket.”</p>
      <button className="btn btn-ghost" disabled={!consent || voice.status === "connecting" || phone.mode === "live"} onClick={() => void voice.start()}>{voice.status === "connecting" ? "Connecting stylist…" : "Start photo voice styling"}</button>
    </>}
    {transcript && <p className="try-on-fine">{transcript}</p>}
    {notice && <p role="status" className="try-on-fine">{notice}</p>}
    {voice.error && <p role="alert" className="try-on-error">{voice.error}</p>}
  </section>;
}
