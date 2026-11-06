"use client";

import { eventSchema, telemetrySlug, type EventName, type EventProperties } from "./schema";

const STORAGE_KEY = "halloween:anonymous-journey:v1";
let fallbackJourney: { id: string; sequence: number } | undefined;

function privacyRequested() {
  return navigator.doNotTrack === "1" ||
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

function nextJourneyEvent() {
  let journey = fallbackJourney;
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const value: unknown = JSON.parse(stored);
      if (value && typeof value === "object" && "id" in value && "sequence" in value &&
        typeof value.id === "string" && /^[0-9a-f]{32}$/.test(value.id) &&
        typeof value.sequence === "number" && Number.isInteger(value.sequence) && value.sequence >= 0) {
        journey = { id: value.id, sequence: value.sequence };
      }
    }
  } catch { /* Private browsing can disable storage; keep this page's ID in memory. */ }
  if (!journey) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    journey = { id: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""), sequence: 0 };
  }
  if (journey.sequence >= 1_000) return;
  journey.sequence++;
  fallbackJourney = journey;
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(journey)); } catch { /* Measurement must never block the task. */ }
  return { journeyId: journey.id, sequence: journey.sequence };
}

/** Best effort only. Pass fixed labels and measured counts, never user content. */
export function trackEvent(name: EventName, properties: EventProperties = {}): void {
  if (typeof window === "undefined" || privacyRequested()) return;
  try {
    const journey = nextJourneyEvent();
    if (!journey) return;
    const slug = telemetrySlug(properties.slug);
    const parsed = eventSchema.safeParse({
      version: 1, ...journey, name,
      properties: { ...properties, slug },
    });
    if (!parsed.success) return;
    // keepalive lets checkout navigation proceed while the small request finishes.
    void fetch("/api/events", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "omit", mode: "same-origin", keepalive: true,
      body: JSON.stringify(parsed.data),
    }).catch(() => {});
  } catch { /* Analytics failure must never change shopping or camera behavior. */ }
}
