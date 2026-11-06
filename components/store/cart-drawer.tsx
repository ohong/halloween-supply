"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SCREENSHOT_SLUG, costumeName, formatExactPrice, formatPrice, useCart } from "@/lib/cart/context";
import { costumePath, customLookId, type CheckoutRequest, type CheckoutResponse, type PriceChange } from "@/lib/checkout/types";
import type { CartItem } from "@/lib/types";
import { ProductImage } from "./product-image";
import { trackEvent } from "@/lib/telemetry/client";
import "./cart-recovery.css";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; cartKey: string }
  | { kind: "redirecting"; cartKey: string }
  | { kind: "price_changed"; cartKey: string; changes: PriceChange[]; subtotalCents: number; text: string }
  | { kind: "recovery"; cartKey: string; result: Extract<CheckoutResponse, { status: "sold_out" | "invalid_size" | "unverified" }> }
  | { kind: "needs_sizes"; cartKey: string; pieceIds: string[]; text: string }
  | { kind: "message"; cartKey: string; text: string };

const subscribeToHydration = () => () => {};

export function CartDrawer({ demoDefaultSizes = false }: { demoDefaultSizes?: boolean }) {
  // The shared cart can open before this Suspense boundary hydrates.
  // Keep its first client markup equal to the server's closed drawer.
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  return hydrated ? <CartDrawerContents demoDefaultSizes={demoDefaultSizes} /> : null;
}

function CartDrawerContents({ demoDefaultSizes }: { demoDefaultSizes: boolean }) {
  const cart = useCart();
  const { items, isOpen, setOpen, costumeSlug } = cart;
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const lineRefs = useRef(new Map<string, HTMLLIElement>());
  const approvedPrices = useRef(new Map<string, number>());
  const pathname = usePathname();
  const cartKey = JSON.stringify([costumeSlug, items.map(({ pieceId, productId, size, priceCents }) => [pieceId, productId, size, priceCents])]);
  const latestKey = useRef(cartKey);
  useEffect(() => { latestKey.current = cartKey; }, [cartKey]);
  const currentStatus = useMemo(() => status.kind === "idle" || status.cartKey === cartKey ? status : { kind: "idle" } as const, [status, cartKey]);
  const priceKey = (line: Pick<CartItem, "pieceId" | "productId">) => JSON.stringify([costumeSlug, line.pieceId, line.productId]);

  useEffect(() => {
    if (!isOpen) return;
    const pieceId = currentStatus.kind === "recovery" ? currentStatus.result.pieceId : currentStatus.kind === "needs_sizes" ? currentStatus.pieceIds[0] : null;
    const line = pieceId ? lineRefs.current.get(pieceId) : null;
    line?.focus();
    line?.scrollIntoView({ block: "nearest" });
  }, [currentStatus, isOpen]);

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
    const startedAt = performance.now();
    const mode = demoDefaultSizes ? "demo" : "live";
    if (acceptChanges && currentStatus.kind === "price_changed") {
      for (const change of currentStatus.changes) approvedPrices.current.set(priceKey(change), change.newCents);
      trackEvent("checkout_recovery", { source: "checkout", slug: costumeSlug, stage: "prices_accepted", provider: "stripe", mode });
    }
    trackEvent("checkout_start", { source: "checkout", slug: costumeSlug, stage: "request", units: items.length, mode });
    // Approval belongs to the same product in this cart, never to a replacement.
    const activePriceKeys = new Set(items.map(priceKey));
    for (const key of approvedPrices.current.keys()) if (!activePriceKeys.has(key)) approvedPrices.current.delete(key);
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
        priceCents: approvedPrices.current.get(priceKey(line)) ?? line.priceCents,
      })),
    };
    try {
      const response = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = (await response.json()) as CheckoutResponse;
      if (latestKey.current !== cartKey) return;
      switch (result.status) {
        case "ok":
          setStatus({ kind: "redirecting", cartKey });
          trackEvent("checkout_redirect", { source: "checkout", slug: costumeSlug, stage: "redirect", provider: "stripe", durationMs: performance.now() - startedAt, mode });
          window.location.assign(result.url);
          return;
        case "price_changed":
          trackEvent("checkout_recovery", { source: "checkout", slug: costumeSlug, stage: "price_changed", provider: "merchant", durationMs: performance.now() - startedAt, mode });
          setStatus({ kind: "price_changed", cartKey, changes: result.priceChanges, text: result.message,
            // Include earlier approvals from this exact request, even after repairing another line.
            subtotalCents: items.reduce((sum, line) => sum + (
              result.priceChanges.find((change) => change.pieceId === line.pieceId && change.productId === line.productId)?.newCents
              ?? body.acceptedPrices?.find((price) => price.pieceId === line.pieceId && price.productId === line.productId)?.priceCents
              ?? line.priceCents
            ), 0),
          });
          return;
        case "sold_out":
        case "invalid_size":
        case "unverified":
          trackEvent("checkout_recovery", { source: "checkout", slug: costumeSlug, stage: result.status, provider: "merchant", durationMs: performance.now() - startedAt, mode });
          setStatus({ kind: "recovery", cartKey, result });
          return;
        case "needs_sizes":
          trackEvent("checkout_recovery", { source: "checkout", slug: costumeSlug, stage: "needs_sizes", durationMs: performance.now() - startedAt, mode });
          setStatus({ kind: "needs_sizes", cartKey, pieceIds: result.pieceIds, text: result.message });
          return;
        case "error":
          trackEvent("checkout_recovery", { source: "checkout", slug: costumeSlug, stage: "error", durationMs: performance.now() - startedAt, mode });
          setStatus({ kind: "message", cartKey, text: result.message });
          return;
        default:
          throw new Error("Unexpected checkout response");
      }
    } catch {
      if (latestKey.current !== cartKey) return;
      trackEvent("checkout_recovery", { source: "checkout", slug: costumeSlug, stage: "error", durationMs: performance.now() - startedAt, mode });
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
                {group.lines.map((line) => {
                  const recovery = currentStatus.kind === "recovery" && currentStatus.result.pieceId === line.pieceId && currentStatus.result.productId === line.productId ? currentStatus.result : null;
                  const needsSize = currentStatus.kind === "needs_sizes" && currentStatus.pieceIds.includes(line.pieceId);
                  return <li className="cart-line" key={line.pieceId} tabIndex={-1} ref={(node) => { if (node) lineRefs.current.set(line.pieceId, node); else lineRefs.current.delete(line.pieceId); }} aria-label={`${line.pieceName}${recovery || needsSize ? ", needs attention" : ""}`}>
                  <span className="cart-thumb"><ProductImage src={line.image} alt="" /></span>
                  <div className="cart-line-body">
                    <p className="cart-line-piece">{line.pieceName}</p>
                    <a className="cart-line-title" href={line.productUrl} target="_blank" rel="noopener noreferrer">{line.title}</a>
                    <p className={`cart-line-size ${demoDefaultSizes || line.size || line.sizeKind === "one_size" ? "" : "is-needed"}`}>
                      {line.sizeKind === "one_size" ? "One size" : line.size ? `Size ${line.size}` : demoDefaultSizes ? "Medium · demo default" : "Size needed"}
                    </p>
                    {(recovery || needsSize) && <div className="notice" role="alert" data-checkout-recovery={recovery?.status ?? "needs_sizes"}>
                      <p>{recovery?.message ?? `Choose a size for ${line.pieceName.toLowerCase()}.`}</p>
                      {(recovery?.status === "invalid_size" || needsSize) && <div>
                        <p>Offered sizes{recovery?.status === "invalid_size" ? " from the merchant" : " in the catalog"}:</p>
                        {(recovery?.status === "invalid_size" ? recovery.availableSizes : line.availableSizes).length > 0
                          ? (recovery?.status === "invalid_size" ? recovery.availableSizes : line.availableSizes).map((size) => <button type="button" className="text-btn" key={size} aria-label={`Choose size ${size} for ${line.pieceName}`} onClick={() => {
                            if (!costumeSlug) return;
                            cart.add({ ...line, availableSizes: recovery?.status === "invalid_size" ? recovery.availableSizes : line.availableSizes, size }, costumeSlug);
                          }}>{size}</button>)
                          : <p>No available size was confirmed. Choose another piece.</p>}
                      </div>}
                      {recovery && <>
                        {recovery.alternatives.length > 0 && <div>
                          <p>Other catalog picks. Stock and prices are checked at checkout.</p>
                          {recovery.alternatives.map(({ item, availability }) => <div key={item.productId}>
                            <button type="button" className="text-btn" onClick={() => { if (costumeSlug) cart.add(item, costumeSlug); }}>Replace with {item.title} · {formatExactPrice(item.priceCents)}</button>
                            {availability === "unknown" && <p>Stock unknown</p>}
                            <a className="text-btn" href={item.productUrl} target="_blank" rel="noopener noreferrer">View at {item.merchantName} ↗</a>
                          </div>)}
                        </div>}
                        {recovery.alternativesHref && <Link className="text-btn" href={recovery.alternativesHref} onClick={() => setOpen(false)}>Compare alternatives →</Link>}
                        {recovery.status === "unverified" && <button type="button" className="text-btn" onClick={() => void checkout()}>Retry live check</button>}
                        <p>You can remove this piece and keep the rest of your cart.</p>
                      </>}
                    </div>}
                  </div>
                  <div className="cart-line-side">
                    <span>{formatPrice(line.priceCents)}</span>
                    <button type="button" className="text-btn" disabled={busy} onClick={() => cart.remove(line.pieceId)} aria-label={`Remove ${line.pieceName}`}>Remove</button>
                  </div>
                </li>; })}
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
        {currentStatus.kind === "needs_sizes" && <p className="notice" role="alert">{currentStatus.text}</p>}
        {currentStatus.kind === "recovery" && <p className="meta" role="status">Review {currentStatus.result.pieceName.toLowerCase()} above. Your other pieces are still in the cart.</p>}
        {currentStatus.kind === "price_changed" && <div className="notice" role="alert">
          <p>{currentStatus.text}</p>
          <ul>{currentStatus.changes.map((change) => <li key={change.pieceId}>{change.pieceName}: {formatExactPrice(change.oldCents)} → {formatExactPrice(change.newCents)}</li>)}</ul>
          <p>New subtotal: {formatExactPrice(currentStatus.subtotalCents)}</p>
        </div>}
        {currentStatus.kind === "redirecting" && <p className="notice" role="status">Taking you to checkout…</p>}
        <button type="button" className="btn btn-block" onClick={() => void checkout(currentStatus.kind === "price_changed")} disabled={busy || (!demoDefaultSizes && missingSizes > 0)}>
          {currentStatus.kind === "loading" ? "Checking stock and prices…" : currentStatus.kind === "price_changed" ? "Accept prices and checkout" : "Checkout"}
        </button>
      </div>}
    </aside>
  </div>;
}
