"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CartItem } from "../types";
import { costumes, liveCostumeSlug } from "../costumes";

// One costume per guest cart. Shared piece IDs cannot mix two different looks.

const storageKey = "halloween-supply-cart-v1";
export const sizesStorageKey = "halloween-supply-sizes-v1";
export const pieceSizesStorageKey = "halloween-supply-piece-sizes-v1";

export interface CartApi {
  items: CartItem[];
  costumeSlug: string | null;
  notice: string | null;
  dismissNotice: () => void;
  /** True once the stored cart has been read on the client. */
  ready: boolean;
  totalCents: number;
  /** Adds or replaces the line for item.pieceId. Keeps an existing size when the new item has none. */
  add: (item: CartItem, costumeSlug: string) => void;
  addMany: (items: CartItem[], costumeSlug: string) => void;
  remove: (pieceId: string) => void;
  /** Sets the size on the line for pieceId. No-op when that piece is not in the cart. */
  setSize: (pieceId: string, size: string | null) => void;
  clear: () => void;
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}

const CartContext = createContext<CartApi | null>(null);
type CartState = (
  | { costumeSlug: null; items: [] }
  | { costumeSlug: string; items: CartItem[] }
) & { notice: string | null };

const emptyCart: CartState = { costumeSlug: null, items: [], notice: null };

function costumeName(slug: string) {
  return costumes.find((costume) => costume.slug === slug)?.name ?? slug;
}

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

function readStored(): CartState {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    // The original array-only cart belonged to the cowboy, the only live look then.
    const stored = Array.isArray(value) ? { costumeSlug: liveCostumeSlug, items: value } : value;
    if (!stored || typeof stored !== "object") return emptyCart;
    const { costumeSlug, items: rawItems } = stored as Record<string, unknown>;
    if (typeof costumeSlug !== "string" || !costumes.some((costume) => costume.slug === costumeSlug) || !Array.isArray(rawItems)) return emptyCart;
    const items = [...new Map(rawItems.filter(isCartItem).slice(0, 30).map((item) => [item.pieceId, item])).values()];
    return items.length > 0 ? { costumeSlug, items, notice: null } : emptyCart;
  } catch {
    return emptyCart;
  }
}

function merge(current: CartItem[], incoming: CartItem[]): CartItem[] {
  let savedSizes: Record<string, unknown> = {};
  let savedPieceSizes: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(localStorage.getItem(sizesStorageKey) ?? "{}");
    if (value && typeof value === "object") savedSizes = value as Record<string, unknown>;
  } catch { /* Sizes remain optional until the assistant records them. */ }
  try {
    const value: unknown = JSON.parse(localStorage.getItem(pieceSizesStorageKey) ?? "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) savedPieceSizes = value as Record<string, unknown>;
  } catch { /* General sizes still apply when no piece overrides are stored. */ }
  const next = [...current];
  for (const item of incoming) {
    const index = next.findIndex((line) => line.pieceId === item.pieceId);
    const saved = savedSizes[item.sizeKind];
    const pieceSize = savedPieceSizes[item.pieceId];
    const size = (typeof pieceSize === "string" && pieceSize.trim().length > 0 && pieceSize.length <= 80 ? pieceSize : null)
      ?? item.size ?? (index >= 0 ? next[index].size : null) ?? (typeof saved === "string" ? saved : null);
    if (index === -1) next.push({ ...item, size });
    else next[index] = { ...item, size };
  }
  return next;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CartState>(emptyCart);
  const [ready, setReady] = useState(false);
  const [isOpen, setOpen] = useState(false);

  useEffect(() => {
    // Reading browser storage has to wait for the client.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(readStored());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ costumeSlug: state.costumeSlug, items: state.items })); }
    catch { /* Keep the cart in memory when storage is blocked. */ }
  }, [state.costumeSlug, state.items, ready]);

  const addMany = useCallback((incoming: CartItem[], costumeSlug: string) => {
    if (!costumes.some((costume) => costume.slug === costumeSlug)) throw new Error("Cannot add pieces without a known costume.");
    if (incoming.length === 0) return;
    setState((current) => {
      return {
        costumeSlug,
        items: merge(current.costumeSlug === costumeSlug ? current.items : [], incoming),
        notice: current.costumeSlug !== null && current.costumeSlug !== costumeSlug
          ? `Started a cart for ${costumeName(costumeSlug)}. The ${costumeName(current.costumeSlug)} pieces were removed.`
          : current.notice,
      };
    });
  }, []);
  const add = useCallback((item: CartItem, costumeSlug: string) => addMany([item], costumeSlug), [addMany]);
  const remove = useCallback((pieceId: string) => setState((current) => {
    if (current.costumeSlug === null) return current;
    const items = current.items.filter((line) => line.pieceId !== pieceId);
    return items.length > 0 ? { ...current, items } : emptyCart;
  }), []);
  const setSize = useCallback((pieceId: string, size: string | null) => setState((current) => current.costumeSlug === null ? current : {
    ...current, items: current.items.map((line) => line.pieceId === pieceId ? { ...line, size } : line),
  }), []);
  const clear = useCallback(() => setState(emptyCart), []);
  const dismissNotice = useCallback(() => setState((current) => ({ ...current, notice: null })), []);

  const value = useMemo<CartApi>(() => ({
    items: state.items, costumeSlug: state.costumeSlug, notice: state.notice, dismissNotice,
    ready, isOpen, setOpen, add, addMany, remove, setSize, clear,
    totalCents: state.items.reduce((sum, line) => sum + line.priceCents, 0),
  }), [state, ready, isOpen, add, addMany, remove, setSize, clear, dismissNotice]);

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
