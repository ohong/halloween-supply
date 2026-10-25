"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SCREENSHOT_SLUG, costumeName, formatExactPrice, formatPrice, useCart } from "@/lib/cart/context";
import { costumePath, customLookId, type CheckoutRequest, type CheckoutResponse, type PriceChange } from "@/lib/checkout/types";
import type { CartItem } from "@/lib/types";
import { ProductImage } from "./product-image";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; cartKey: string }
  | { kind: "redirecting"; cartKey: string }
  | { kind: "price_changed"; cartKey: string; changes: PriceChange[]; text: string }
  | { kind: "message"; cartKey: string; text: string };

export function CartDrawer({ demoDefaultSizes = false }: { demoDefaultSizes?: boolean }) {
  const cart = useCart();
  const { items, isOpen, setOpen, costumeSlug } = cart;
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const cartKey = JSON.stringify([costumeSlug, items.map(({ pieceId, productId, size, priceCents }) => [pieceId, productId, size, priceCents])]);
  const latestKey = useRef(cartKey);
  useEffect(() => { latestKey.current = cartKey; }, [cartKey]);
  const currentStatus = status.kind === "idle" || status.cartKey === cartKey ? status : { kind: "idle" } as const;

  useEffect(() => {
    // Back from hosted checkout can restore this exact page from the browser cache.
    const resume = () => setStatus((current) => current.kind === "redirecting" ? { kind: "idle" } : current);
    window.addEventListener("pageshow", resume);
    return () => window.removeEventListener("pageshow", resume);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const drawer = drawerRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab") return;
      const controls = drawer?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), [tabindex='0']");
      const first = controls?.[0];
      const last = controls?.[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      if (document.activeElement === document.body || drawer?.contains(document.activeElement)) previousFocus?.focus();
    };
  }, [isOpen, setOpen]);

  const groups = useMemo(() => {
    const byMerchant = new Map<string, { id: string; name: string; lines: CartItem[] }>();
    for (const line of items) {
      const group = byMerchant.get(line.merchantId) ?? { id: line.merchantId, name: line.merchantName, lines: [] };
      group.lines.push(line);
      byMerchant.set(line.merchantId, group);
    }
    return [...byMerchant.values()];
  }, [items]);

  const shared = groups.filter((group) => group.lines.length > 1);
  const sizedPieces = items.filter((line) => line.sizeKind !== "one_size").length;
  const missingSizes = items.filter((line) => line.sizeKind !== "one_size" && !line.size).length;

  async function checkout(acceptChanges = false) {
    if (!costumeSlug) return;
    setStatus({ kind: "loading", cartKey });
    const body: CheckoutRequest = {
      costumeSlug,
      items: items.map((line) => ({
        pieceId: line.pieceId,
        productId: line.productId,
        size: line.size,
        // Screenshot pieces are not in the catalog, so the server re-verifies them from these details.
        ...(costumeSlug === SCREENSHOT_SLUG ? { web: { url: line.productUrl, title: line.title, image: line.image, merchantName: line.merchantName, pieceName: line.pieceName, sizeKind: line.sizeKind } } : {}),
      })),
      acceptedPrices: items.map((line) => ({
        pieceId: line.pieceId,
        productId: line.productId,
        priceCents: acceptChanges && currentStatus.kind === "price_changed"
          ? currentStatus.changes.find((change) => change.pieceId === line.pieceId && change.productId === line.productId)?.newCents ?? line.priceCents
          : line.priceCents,
      })),
    };
    try {
      const response = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = (await response.json()) as CheckoutResponse;
      if (latestKey.current !== cartKey) return;
      switch (result.status) {
        case "ok":
          setStatus({ kind: "redirecting", cartKey });
          window.location.assign(result.url);
          return;
        case "price_changed":
          setStatus({ kind: "price_changed", cartKey, changes: result.priceChanges, text: result.message });
          return;
        case "sold_out":
        case "needs_sizes":
        case "invalid_size":
        case "unverified":
        case "error":
          setStatus({ kind: "message", cartKey, text: result.message });
          return;
        default:
          throw new Error("Unexpected checkout response");
      }
    } catch {
      setStatus({ kind: "message", cartKey, text: "Checkout is unavailable right now. Try again in a moment." });
    }
  }

  if (!isOpen) return null;
  const busy = currentStatus.kind === "loading" || currentStatus.kind === "redirecting";
  const lookPath = costumeSlug ? costumePath(costumeSlug) : "/";
  const onCostume = costumeSlug !== null && pathname === lookPath;
  const webLook = costumeSlug === SCREENSHOT_SLUG || customLookId(costumeSlug) !== null;

  function askForSizes() {
    setOpen(false);
    window.dispatchEvent(new Event("halloween:open-assistant"));
  }

  return <div className="drawer-root">
    <div className="drawer-scrim" onClick={() => setOpen(false)} />
    <aside className="drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-label="Cart">
      <div className="drawer-head">
        <div><h2>Cart</h2>{costumeSlug && <p className="meta">{costumeName(costumeSlug)} · One costume per cart</p>}</div>
        <button type="button" className="text-btn" ref={closeRef} onClick={() => setOpen(false)}>Close</button>
      </div>

      {cart.notice && <div className="notice" role="status">
        <p>{cart.notice}</p>
        <button type="button" className="text-btn" onClick={cart.dismissNotice}>Dismiss</button>
      </div>}

      {items.length === 0
        ? <p className="drawer-empty">Your cart is empty. Add a piece or the whole costume.</p>
        : <div className="drawer-scroll">
            {groups.map((group) => <section className="cart-group" key={group.id}>
              <h3>{group.name}{group.lines.length > 1 && <span className="meta"> · {group.lines.length} pieces, one order</span>}</h3>
              <ul>
                {group.lines.map((line) => <li className="cart-line" key={line.pieceId}>
                  <span className="cart-thumb"><ProductImage src={line.image} alt="" /></span>
                  <div className="cart-line-body">
                    <p className="cart-line-piece">{line.pieceName}</p>
                    <a className="cart-line-title" href={line.productUrl} target="_blank" rel="noopener noreferrer">{line.title}</a>
                    <p className={`cart-line-size ${demoDefaultSizes || line.size || line.sizeKind === "one_size" ? "" : "is-needed"}`}>
                      {line.sizeKind === "one_size" ? "One size" : line.size ? `Size ${line.size}` : demoDefaultSizes ? "Medium · demo default" : "Size needed"}
                    </p>
                  </div>
                  <div className="cart-line-side">
                    <span>{formatPrice(line.priceCents)}</span>
                    <button type="button" className="text-btn" disabled={busy} onClick={() => cart.remove(line.pieceId)} aria-label={`Remove ${line.pieceName}`}>Remove</button>
                  </div>
                </li>)}
              </ul>
            </section>)}
            <p className="fewest-note">
              Fewest shops: {items.length} {items.length === 1 ? "piece" : "pieces"} from {groups.length} {groups.length === 1 ? "shop" : "shops"}.
              {shared.length > 0 ? ` ${shared.map((g) => g.name).join(" and ")} ${shared.length > 1 ? "each supply" : "supplies"} several pieces. We combine them into one order per shop.` : " Ask the assistant to find more pieces from the same shop."}
            </p>
          </div>}

      {items.length > 0 && <div className="drawer-foot">
        <div className="subtotal"><span>Subtotal</span><span>{formatPrice(cart.totalCents)}</span></div>
        <p className="meta">Merchant prices only. Shipping address is collected at checkout.</p>
        {sizedPieces > 0 && <div className="size-reminder">
          {missingSizes > 0 && <p className={`meta${demoDefaultSizes ? "" : " is-needed"}`}>{demoDefaultSizes ? "Unselected sizes default to Medium for this demo." : `${missingSizes} ${missingSizes === 1 ? "piece needs" : "pieces need"} a size.`}</p>}
          {webLook
            ? <Link className="text-btn" href={lookPath} onClick={() => setOpen(false)}>{missingSizes > 0 && !demoDefaultSizes ? "Pick sizes on your look" : "Update sizes on your look"} →</Link>
            : onCostume
            ? <button type="button" className="text-btn" onClick={askForSizes}>{missingSizes > 0 && !demoDefaultSizes ? "Tell the assistant your sizes" : "Update sizes with the assistant"} →</button>
            : <Link className="text-btn" href={`/costumes/${costumeSlug}?assistant=sizes`} onClick={() => setOpen(false)}>{missingSizes > 0 && !demoDefaultSizes ? "Tell the assistant your sizes" : "Update sizes with the assistant"} →</Link>}
        </div>}
        {currentStatus.kind === "message" && <p className="notice" role="alert">{currentStatus.text}</p>}
        {currentStatus.kind === "price_changed" && <div className="notice" role="alert">
          <p>{currentStatus.text}</p>
          <ul>{currentStatus.changes.map((change) => <li key={change.pieceId}>{change.pieceName}: {formatExactPrice(change.oldCents)} → {formatExactPrice(change.newCents)}</li>)}</ul>
          <p>New subtotal: {formatExactPrice(items.reduce((sum, line) => sum + (currentStatus.changes.find((change) => change.pieceId === line.pieceId && change.productId === line.productId)?.newCents ?? line.priceCents), 0))}</p>
        </div>}
        {currentStatus.kind === "redirecting" && <p className="notice" role="status">Taking you to checkout…</p>}
        <button type="button" className="btn btn-block" onClick={() => void checkout(currentStatus.kind === "price_changed")} disabled={busy || (!demoDefaultSizes && missingSizes > 0)}>
          {currentStatus.kind === "loading" ? "Checking stock and prices…" : currentStatus.kind === "price_changed" ? "Accept prices and checkout" : "Checkout"}
        </button>
      </div>}
    </aside>
  </div>;
}
