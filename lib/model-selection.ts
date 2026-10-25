"use client";

import { useSyncExternalStore } from "react";

type Model = "male" | "female";
const storageKey = "halloween-supply-model";
const changeEvent = "costume-model-changed";
let fallback: Model = "female";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(changeEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(changeEvent, callback);
  };
}

function getSnapshot(): Model {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "male" || value === "female" ? value : fallback;
  } catch { return fallback; }
}

export function modelImage(slug: string, model: Model) {
  return `/costumes/models/${slug}-${model}.webp`;
}

export function useCostumeModel() {
  // The server default stays stable; hydration restores this browser's preference.
  const model = useSyncExternalStore(subscribe, getSnapshot, (): Model => "female");
  function setModel(next: Model) {
    fallback = next;
    try { localStorage.setItem(storageKey, next); }
    catch { /* Navigation still preserves the choice when browser storage is blocked. */ }
    window.dispatchEvent(new Event(changeEvent));
  }
  return { model, setModel };
}
