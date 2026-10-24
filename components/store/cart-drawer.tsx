"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { formatPrice, useCart } from "@/lib/cart/context";
import type { CheckoutRequest, CheckoutResponse, PriceChange } from "@/lib/checkout/types";
import type { CartItem } from "@/lib/types";
import type { FewestShopsSuggestion } from "@/app/api/fewest-shops/route";
import { Close } from "@/components/icons";
import { ProductImage } from "./product-image";

type CheckoutState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "price_changes"; url: string; changes: PriceChange[] }
  | { kind: "sizes"; message: string }
  | { kind: "sold_out"; pieceName: string; message: string }
  | { kind: "error"; message: string };

const DEFAULT_SLUG = "cosmic-cowboy";

/** Cart slide-over: a modal <dialog> (focus trap, Esc, inert page) that fades in. */
export function CartDrawer() {
  const { items, ready, totalCents, remove, addMany, clear, isOpen, setOpen } = useCart();
  const dialog = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const [checkout, setCheckout] = useState<CheckoutState>({ kind: "idle" });
  const [suggestions, setSuggestions] = useState<{ key: string; list: FewestShopsSuggestion[] }>({ key: "", list: [] });

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (isOpen && !el.open) el.showModal();
    else if (!isOpen && el.open) el.close();
  }, [isOpen]);

  // Reset any checkout message when the cart changes underneath it.
  const cartKey = items.map((i) => `${i.pieceId}:${i.productId}`).join("|");
  const [seenKey, setSeenKey] = useState(cartKey);
  if (seenKey !== cartKey) { setSeenKey(cartKey); setCheckout({ kind: "idle" }); }

  // "Fewest shops": ask the graph whether another shop could cover several cart pieces.
  useEffect(() => {
    if (!isOpen || items.length < 2) return;
    const controller = new AbortController();
    fetch("/api/fewest-shops", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: items.map((i) => ({ pieceId: i.pieceId, productId: i.productId })) }),
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : { suggestions: [] }))
      .then((data: { suggestions?: FewestShopsSuggestion[] }) => setSuggestions({ key: cartKey, list: data.suggestions ?? [] }))
      .catch(() => { /* The note is optional; ignore network errors. */ });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, cartKey]);

  const suggestion = (() => {
    if (suggestions.key !== cartKey) return null;
    for (const s of suggestions.list) {
      const swaps = s.items.filter((entry, i, all) => all.findIndex((o) => o.pieceId === entry.pieceId) === i)
        .filter((entry) => items.some((l) => l.pieceId === entry.pieceId && l.productId !== entry.option.product.id));
      if (swaps.length > 0) return { merchant: s.merchant, carries: s.items.length, swaps };
    }
    return null;
  })();

  // Cart lines that already ship from one merchant.
  const merchantCounts = new Map<string, { name: string; n: number }>();
  for (const l of items) merchantCounts.set(l.merchantId, { name: l.merchantName, n: (merchantCounts.get(l.merchantId)?.n ?? 0) + 1 });
  const sharedNow = [...merchantCounts.values()].filter((m) => m.n > 1);

  const consolidate = () => {
    if (!suggestion) return;
    const next: CartItem[] = suggestion.swaps.flatMap(({ pieceId, option }) => {
      const line = items.find((l) => l.pieceId === pieceId);
      if (!line) return [];
      return [{
        ...line,
        productId: option.product.id,
        title: option.product.title,
        productUrl: option.product.url,
        image: option.product.image,
        merchantId: option.merchant.id,
        merchantName: option.merchant.name,
        priceCents: option.product.priceCents,
      }];
    });
    addMany(next);
  };

  const slug = /^\/costumes\/([^/]+)/.exec(pathname)?.[1] ?? DEFAULT_SLUG;
  const missingSizes = items.filter((l) => l.sizeKind !== "one_size" && !l.size);

  async function startCheckout() {
    setCheckout({ kind: "loading" });
    const payload: CheckoutRequest = { costumeSlug: slug, items: items.map((l) => ({ pieceId: l.pieceId, productId: l.productId, size: l.size })) };
    try {
      const res = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = (await res.json()) as CheckoutResponse;
      switch (data.status) {
        case "ok":
          if (data.priceChanges.length > 0) setCheckout({ kind: "price_changes", url: data.url, changes: data.priceChanges });
          else window.location.assign(data.url);
          return;
        case "sold_out": setCheckout({ kind: "sold_out", pieceName: data.pieceName, message: data.message }); return;
        case "needs_sizes": setCheckout({ kind: "sizes", message: data.message }); return;
        default: setCheckout({ kind: "error", message: data.message || "Checkout isn’t available right now. Please try again." });
      }
    } catch {
      setCheckout({ kind: "error", message: "We couldn’t reach checkout. Check your connection and try again." });
    }
  }

  const goToAssistant = () => {
    setOpen(false);
    const target = document.getElementById("assistant");
    if (target) { target.scrollIntoView({ block: "start" }); target.querySelector<HTMLElement>("textarea, input, button")?.focus({ preventScroll: true }); }
    else router.push(`/costumes/${slug}#assistant`);
  };

  const count = ready ? items.length : 0;
  return (
    <dialog
      ref={dialog}
      className="cart-dialog"
      aria-labelledby="cart-title"
      onClose={() => setOpen(false)}
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div className="cart-inner">
        <div className="cart-head">
          <h2 id="cart-title">Cart{count > 0 && <span className="mono"> ({count})</span>}</h2>
          <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close cart"><Close /></button>
        </div>
        {count === 0 ? (
          <div className="cart-body">
            <div className="cart-empty">
              <p>Your cart is empty.</p>
              <p>Pick a piece, or add the whole costume in one click.</p>
              <Link href={`/costumes/${DEFAULT_SLUG}`} className="btn btn-quiet" onClick={() => setOpen(false)}>See the Cosmic Cowboy</Link>
            </div>
          </div>
        ) : (
          <>
            <div className="cart-body">
              <ul>
                {items.map((line) => (
                  <li className="cart-line" key={line.pieceId}>
                    <div className="thumb"><ProductImage src={line.image} alt="" sizes="72px" /></div>
                    <div>
                      <p className="eyebrow mono">{line.pieceName}</p>
                      <p className="cart-line-title">{line.title}</p>
                      <p className="cart-line-meta">{line.merchantName}</p>
                      {line.sizeKind !== "one_size" && (line.size
                        ? <p className="cart-size">Size {line.size}</p>
                        : <p className="cart-size is-needed">Size needed</p>)}
                      <button type="button" className="link-button" onClick={() => remove(line.pieceId)} aria-label={`Remove ${line.pieceName}`}>Remove</button>
                    </div>
                    <p className="cart-line-price">{formatPrice(line.priceCents)}</p>
                  </li>
                ))}
              </ul>
              <div className="cart-notes">
                {suggestion && (
                  <div className="note">
                    <p>{suggestion.merchant.name} carries {suggestion.carries} of your pieces — swap to consolidate into fewer orders.</p>
                    <button type="button" className="btn btn-quiet" onClick={consolidate}>Swap {suggestion.swaps.length === 1 ? "1 piece" : `${suggestion.swaps.length} pieces`} to {suggestion.merchant.name}</button>
                  </div>
                )}
                {!suggestion && sharedNow.map((m) => <p className="note note-quiet" key={m.name}>{m.n} pieces ship from {m.name}.</p>)}
              </div>
            </div>
            <div className="cart-foot">
              {checkout.kind === "price_changes" && (
                <div className="cart-message" role="status">
                  <p>Prices have moved since you added these pieces.</p>
                  <ul className="change-list" style={{ width: "100%" }}>
                    {checkout.changes.map((c) => <li key={c.pieceId}><span>{c.pieceName}</span><span>{formatPrice(c.oldCents)} → {formatPrice(c.newCents)}</span></li>)}
                  </ul>
                </div>
              )}
              {checkout.kind === "sold_out" && (
                <div className="cart-message" role="alert">
                  <p>{checkout.pieceName} just sold out at the merchant. Swap it for another pick on the costume page, then check out again.</p>
                  <button type="button" className="link-button" onClick={() => { setOpen(false); router.push(`/costumes/${slug}`); }}>Back to the costume</button>
                </div>
              )}
              {(checkout.kind === "sizes" || (checkout.kind === "idle" && missingSizes.length > 0)) && (
                <div className="cart-message" role={checkout.kind === "sizes" ? "alert" : undefined}>
                  <p>{checkout.kind === "sizes" ? checkout.message : "Tell the shopping assistant your sizes to continue."}</p>
                  <button type="button" className="link-button" onClick={goToAssistant}>Tell the assistant my sizes</button>
                </div>
              )}
              {checkout.kind === "error" && <div className="cart-message" role="alert"><p>{checkout.message}</p></div>}
              <p className="cart-total"><span>Total</span><span>{formatPrice(totalCents)}</span></p>
              {checkout.kind === "price_changes"
                ? <button type="button" className="btn btn-block" onClick={() => window.location.assign(checkout.url)}>Continue to payment</button>
                : <button type="button" className="btn btn-block" disabled={checkout.kind === "loading"} onClick={startCheckout}>{checkout.kind === "loading" ? "Preparing checkout…" : "Checkout"}</button>}
              <button type="button" className="link-button" onClick={clear}>Clear cart</button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
