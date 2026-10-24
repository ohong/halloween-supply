"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CartItem } from "../types";

// Client-side cart: React context persisted to localStorage. One line per piece.

const storageKey = "halloween-supply-cart-v1";
export const sizesStorageKey = "halloween-supply-sizes-v1";

export interface CartApi {
  items: CartItem[];
  /** True once the stored cart has been read on the client. */
  ready: boolean;
  totalCents: number;
  /** Adds or replaces the line for item.pieceId. Keeps an existing size when the new item has none. */
  add: (item: CartItem) => void;
  addMany: (items: CartItem[]) => void;
  remove: (pieceId: string) => void;
  /** Sets the size on the line for pieceId. No-op when that piece is not in the cart. */
  setSize: (pieceId: string, size: string | null) => void;
  clear: () => void;
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}

const CartContext = createContext<CartApi | null>(null);

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const textFields = ["pieceId", "pieceName", "productId", "title", "productUrl", "image", "merchantId", "merchantName"];
  return textFields.every((key) => typeof item[key] === "string" && item[key].length > 0)
    && ["apparel", "pants", "shoe", "hat", "one_size"].includes(String(item.sizeKind))
    && typeof item.priceCents === "number" && Number.isSafeInteger(item.priceCents) && item.priceCents >= 0
    && (item.size === null || typeof item.size === "string" && item.size.length <= 120)
    && /^https?:\/\//.test(String(item.productUrl))
    && /^(\/|https?:\/\/)/.test(String(item.image));
}

function readStored(): CartItem[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value) ? [...new Map(value.filter(isCartItem).slice(0, 30).map((item) => [item.pieceId, item])).values()] : [];
  } catch {
    return [];
  }
}

function merge(current: CartItem[], incoming: CartItem[]): CartItem[] {
  let savedSizes: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(localStorage.getItem(sizesStorageKey) ?? "{}");
    if (value && typeof value === "object") savedSizes = value as Record<string, unknown>;
  } catch { /* Sizes remain optional until the assistant records them. */ }
  const next = [...current];
  for (const item of incoming) {
    const index = next.findIndex((line) => line.pieceId === item.pieceId);
    const saved = savedSizes[item.sizeKind];
    const size = item.size ?? (index >= 0 ? next[index].size : null) ?? (typeof saved === "string" ? saved : null);
    if (index === -1) next.push({ ...item, size });
    else next[index] = { ...item, size };
  }
  return next;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  const [isOpen, setOpen] = useState(false);

  useEffect(() => {
    // Reading browser storage has to wait for the client.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(readStored());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(storageKey, JSON.stringify(items)); }
    catch { /* Keep the cart in memory when storage is blocked. */ }
  }, [items, ready]);

  const add = useCallback((item: CartItem) => setItems((current) => merge(current, [item])), []);
  const addMany = useCallback((incoming: CartItem[]) => setItems((current) => merge(current, incoming)), []);
  const remove = useCallback((pieceId: string) => setItems((current) => current.filter((line) => line.pieceId !== pieceId)), []);
  const setSize = useCallback((pieceId: string, size: string | null) => setItems((current) => current.map((line) => line.pieceId === pieceId ? { ...line, size } : line)), []);
  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CartApi>(() => ({
    items, ready, isOpen, setOpen, add, addMany, remove, setSize, clear,
    totalCents: items.reduce((sum, line) => sum + line.priceCents, 0),
  }), [items, ready, isOpen, add, addMany, remove, setSize, clear]);

  return <CartContext value={value}>{children}</CartContext>;
}

export function useCart(): CartApi {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("useCart must be used inside <CartProvider>");
  return cart;
}

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}
