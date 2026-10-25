"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CartItem } from "../types";
import { costumes, liveCostumeSlug } from "../costumes";
import { compatibleSize } from "./item";

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
  /** Adds or replaces the line, retaining a size only when the product offers that exact label. */
  add: (item: CartItem, costumeSlug: string) => void;
  addMany: (items: CartItem[], costumeSlug: string) => void;
  /** Refresh existing lines from the visible catalog without adding other products. */
  reconcile: (items: CartItem[], costumeSlug: string) => void;
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

/** A look rebuilt from a screenshot: pieces drawn from any costume in the catalog. */
import { SCREENSHOT_SLUG } from "../checkout/types";
export { SCREENSHOT_SLUG };

const knownSlug = (slug: string) => slug === SCREENSHOT_SLUG || costumes.some((costume) => costume.slug === slug);

export function costumeName(slug: string) {
  if (slug === SCREENSHOT_SLUG) return "Your screenshot look";
  return costumes.find((costume) => costume.slug === slug)?.name ?? slug;
}

function isStoredCartItem(value: unknown): value is Omit<CartItem, "availableSizes"> & { availableSizes?: unknown } {
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

function offeredSizes(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((size): size is string => typeof size === "string" && size.trim().length > 0 && size.length <= 120))].slice(0, 100) : [];
}

function readStored(): CartState {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    // The original array-only cart belonged to the cowboy, the only live look then.
    const stored = Array.isArray(value) ? { costumeSlug: liveCostumeSlug, items: value } : value;
    if (!stored || typeof stored !== "object") return emptyCart;
    const { costumeSlug, items: rawItems } = stored as Record<string, unknown>;
    if (typeof costumeSlug !== "string" || !knownSlug(costumeSlug) || !Array.isArray(rawItems)) return emptyCart;
    const storedItems = [...new Map(rawItems.filter(isStoredCartItem).slice(0, 30).map((item) => [item.pieceId, item])).values()];
    const items = storedItems.map((item) => {
      const line = { ...item, availableSizes: offeredSizes(item.availableSizes) };
      return { ...line, size: compatibleSize(line, item.size) };
    });
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
    const requested = item.size
      ?? (typeof pieceSize === "string" && pieceSize.trim().length > 0 && pieceSize.length <= 80 ? pieceSize : null)
      ?? (index >= 0 ? next[index].size : null) ?? (typeof saved === "string" ? saved : null);
    // Select the preference first, then validate it. Falling through to a different
    // preference after a mismatch would silently choose another garment size.
    const size = compatibleSize(item, requested);
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
    if (!knownSlug(costumeSlug)) throw new Error("Cannot add pieces without a known costume.");
    if (incoming.length === 0) return;
    setState((current) => {
      const items = merge(current.costumeSlug === costumeSlug ? current.items : [], incoming);
      return {
        costumeSlug,
        items,
        notice: current.costumeSlug !== null && current.costumeSlug !== costumeSlug
          ? `Started a cart for ${costumeName(costumeSlug)}. The ${costumeName(current.costumeSlug)} pieces were removed.`
          : current.notice,
      };
    });
  }, []);
  const reconcile = useCallback((options: CartItem[], costumeSlug: string) => {
    setState((current) => {
      if (current.costumeSlug !== costumeSlug) return current;
      const refreshed = current.items.map((line) => {
        const option = options.find((item) => item.pieceId === line.pieceId && item.productId === line.productId);
        return option ? { ...option, size: line.size } : { ...line, availableSizes: [], size: null };
      });
      return { ...current, items: merge(current.items, refreshed) };
    });
  }, []);
  const add = useCallback((item: CartItem, costumeSlug: string) => addMany([item], costumeSlug), [addMany]);
  const remove = useCallback((pieceId: string) => setState((current) => {
    if (current.costumeSlug === null) return current;
    const items = current.items.filter((line) => line.pieceId !== pieceId);
    return items.length > 0 ? { ...current, items } : emptyCart;
  }), []);
  const setSize = useCallback((pieceId: string, size: string | null) => setState((current) => {
    if (current.costumeSlug === null) return current;
    return { ...current, items: current.items.map((line) => line.pieceId === pieceId ? { ...line, size: compatibleSize(line, size) } : line) };
  }), []);
  const clear = useCallback(() => setState(emptyCart), []);
  const dismissNotice = useCallback(() => setState((current) => ({ ...current, notice: null })), []);

  const value = useMemo<CartApi>(() => ({
    items: state.items, costumeSlug: state.costumeSlug, notice: state.notice, dismissNotice,
    ready, isOpen, setOpen, add, addMany, reconcile, remove, setSize, clear,
    totalCents: state.items.reduce((sum, line) => sum + line.priceCents, 0),
  }), [state, ready, isOpen, add, addMany, reconcile, remove, setSize, clear, dismissNotice]);

  return <CartContext value={value}>{children}</CartContext>;
}

export function useCart(): CartApi {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("useCart must be used inside <CartProvider>");
  return cart;
}

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cents / 100);
}

// Price-change approval must show cents even when both amounts round to the same dollar.
export function formatExactPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}
