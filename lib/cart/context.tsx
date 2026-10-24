"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CartItem } from "../types";

// Client-side cart: React context persisted to localStorage. One line per piece.

const storageKey = "halloween-supply-cart-v1";

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

function readStored(): CartItem[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value) ? (value as CartItem[]).filter((item) => item && typeof item.pieceId === "string") : [];
  } catch {
    return [];
  }
}

function merge(current: CartItem[], incoming: CartItem[]): CartItem[] {
  const next = [...current];
  for (const item of incoming) {
    const index = next.findIndex((line) => line.pieceId === item.pieceId);
    if (index === -1) next.push(item);
    else next[index] = { ...item, size: item.size ?? next[index].size };
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
