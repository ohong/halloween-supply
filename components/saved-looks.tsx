"use client";

import { useSyncExternalStore } from "react";
import { Heart } from "./icons";

const storageKey = "halloween-supply-saved";
let fallback = "[]";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("saved-looks-changed", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("saved-looks-changed", callback);
  };
}

function getSnapshot() {
  try { return localStorage.getItem(storageKey) ?? fallback; }
  catch { return fallback; }
}

export function useSavedLooks() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => "[]");
  let saved: string[] = [];
  try {
    const value: unknown = JSON.parse(snapshot);
    if (Array.isArray(value)) saved = value.filter((item): item is string => typeof item === "string");
  } catch { /* A damaged browser value should not prevent browsing. */ }

  function toggle(slug: string) {
    const updated = saved.includes(slug) ? saved.filter((item) => item !== slug) : [...saved, slug];
    fallback = JSON.stringify(updated);
    try { localStorage.setItem(storageKey, fallback); }
    catch { /* Keep saving available in memory when browser storage is blocked. */ }
    window.dispatchEvent(new Event("saved-looks-changed"));
  }
  return { saved, toggle };
}

export function SaveLook({ slug, name, showLabel = false }: { slug: string; name: string; showLabel?: boolean }) {
  const { saved, toggle } = useSavedLooks();
  const isSaved = saved.includes(slug);
  return <button className={`save-look ${showLabel ? "save-look-labeled" : ""} ${isSaved ? "is-saved" : ""}`} aria-label={`${isSaved ? "Unsave" : "Save"} ${name}`} aria-pressed={isSaved} onClick={() => toggle(slug)}><Heart filled={isSaved} />{showLabel && (isSaved ? "Look saved" : "Save this look")}</button>;
}
