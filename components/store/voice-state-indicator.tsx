import type { MirrorStatus } from "@/lib/live-mirror/types";
import type { VoiceActivity } from "@/lib/live-mirror/use-live-voice";
import "./voice-state-indicator.css";

type VoiceState = VoiceActivity | "idle" | "connecting" | "muted" | "error";
type Props = { status: MirrorStatus; activity: VoiceActivity; muted: boolean; onStop: () => void };

const labels: Record<VoiceState, { title: string; detail: string }> = {
  idle: { title: "Voice off", detail: "Type a change, or start voice styling." },
  connecting: { title: "Connecting voice", detail: "Setting up your microphone and stylist." },
  listening: { title: "Listening", detail: "Tell the stylist what you’d like to change." },
  thinking: { title: "Considering your change", detail: "Checking the pieces in your look." },
  speaking: { title: "Stylist speaking", detail: "You can speak to the stylist at any time." },
  muted: { title: "Microphone muted", detail: "You can still hear the stylist." },
  error: { title: "Voice unavailable", detail: "Use the microphone control to try again." },
};

export function VoiceStateIndicator({ status, activity, muted, onStop }: Props) {
  const state: VoiceState = status !== "live" ? status : muted ? "muted" : activity;
  const label = labels[state];
  return <div className="voice-state" data-state={state}>
    <span className="voice-state-orb" aria-hidden="true"><span /><span /><span /></span>
    <div className="voice-state-copy">
      <p className="voice-state-label" role="status" aria-live="polite" aria-atomic="true">{label.title}</p>
      <p className="voice-state-detail">{label.detail}</p>
    </div>
    {(status === "live" || status === "connecting") && <button type="button" className="voice-state-end" onClick={onStop}>{status === "connecting" ? "Cancel" : "End voice"}</button>}
  </div>;
}
