"use client";

import { useSyncExternalStore } from "react";

// Product sizes stay in this browser. They never enter public saved-board records.
const key = "halloween-supply-private-product-sizes-v1";
const event = "private-product-sizes-changed";
let fallback = "{}";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback); window.addEventListener(event, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(event, callback); };
}
function snapshot() { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function parse(value: string): Record<string, string | null> {
  try {
    const data: unknown = JSON.parse(value);
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([id, size]) => /^[\w-]{1,150}$/.test(id) && (size === null || typeof size === "string" && size.length <= 120)).slice(-100));
  } catch { return {}; }
}
export function useLocalProductSizes() {
  const sizes = parse(useSyncExternalStore(subscribe, snapshot, () => "{}"));
  function setSize(productId: string, size: string | null) {
    fallback = JSON.stringify({ ...parse(snapshot()), [productId]: size });
    try { localStorage.setItem(key, fallback); } catch { /* Preserve sizes in memory when storage is blocked. */ }
    window.dispatchEvent(new Event(event));
  }
  return { sizes, setSize };
}
