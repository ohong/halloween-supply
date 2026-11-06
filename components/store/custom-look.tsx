"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { formatPrice, useCart } from "@/lib/cart/context";
import type { CustomLook } from "@/lib/custom-looks/types";
import type { CartItem } from "@/lib/types";
import "./custom-look.css";
import { VirtualTryOn } from "./virtual-try-on";
import { PhoneCameraProvider } from "./phone-camera";
import { useLocalProductSizes } from "./local-product-sizes";
import { compatibleSize } from "@/lib/cart/item";

export function CustomLookView({ look: initialLook }: { look: CustomLook }) {
  const [look, setLook] = useState(initialLook);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [retryError, setRetryError] = useState("");
  const [shareNote, setShareNote] = useState("");
  const retryKeys = useRef<Record<string, string>>({});
  const cart = useCart();
  const { sizes, setSize } = useLocalProductSizes();
  const source = `custom-look:${look.id}`;
  const found = look.pieces.flatMap(({ item }) => item ? [item] : []);
  const missing = look.pieces.length - found.length;
  const total = found.reduce((sum, item) => sum + item.priceCents, 0);
  const ready = look.state !== "running";
  const inCart = (item: CartItem) => cart.costumeSlug === source && cart.items.some((line) => line.pieceId === item.pieceId && line.productId === item.productId);
  const sizeOf = (item: CartItem) => {
    const current = cart.costumeSlug === source ? cart.items.find(line => line.pieceId === item.pieceId && line.productId === item.productId) : undefined;
    return compatibleSize(item, current ? current.size : sizes[item.productId] ?? item.size);
  };
  const allInCart = found.length > 0 && found.every(inCart);

  function chooseSize(item: CartItem, value: string) {
    const size = value || null;
    setSize(item.productId, size);
    if (inCart(item)) cart.setSize(item.pieceId, size);
  }

  function addFound() {
    cart.addMany(found.map((item) => ({ ...item, size: sizeOf(item) })), source);
    for (const item of found) if (Object.hasOwn(sizes, item.productId)) cart.setSize(item.pieceId, sizeOf(item));
    cart.setOpen(true);
  }

  async function retryPiece(pieceIndex: number) {
    if (retrying !== null) return;
    const key = `${look.id}:${pieceIndex}`;
    const requestId = retryKeys.current[key] ??= crypto.randomUUID();
    setRetrying(pieceIndex); setRetryError("");
    try {
      const response = await fetch(`/api/saved-looks/${look.id}/retry`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, pieceIndex }),
      });
      const data = await response.json();
      if (!response.ok || !data.look) throw new Error(data.error ?? "This piece could not be searched again.");
      delete retryKeys.current[key];
      setLook(data.look);
      window.history.replaceState(null, "", `/create/${data.look.id}`);
    } catch (error) { setRetryError(error instanceof Error ? error.message : "This piece could not be searched again."); }
    finally { setRetrying(null); }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(new URL(`/create/${look.id}`, location.origin).toString()); setShareNote("Saved look link copied."); }
    catch { setShareNote("Copy this page’s address to share the saved look."); }
  }

  return <div className="page custom-look">
    <Link href="/" className="back-link">← All costumes</Link>
    <div className="custom-look-heading">
      <div>
        <h1>{look.name}</h1>
        {look.summary && <p>{look.summary}</p>}
      </div>
      {found.length > 0 && <div className="custom-look-total"><span>{found.length} {found.length === 1 ? "piece" : "pieces"}</span><strong>{formatPrice(total)}</strong></div>}
    </div>

    {look.state === "running" && <p className="custom-look-notice" role="status">This look is still being sourced. <button className="text-btn" type="button" onClick={() => window.location.reload()}>Refresh</button></p>}
    {look.error && <p className="custom-look-notice" role="alert">{look.error}</p>}
    {retryError && <p className="custom-look-notice" role="alert">{retryError}</p>}
    <div className="custom-look-share"><button type="button" className="text-btn" onClick={copyLink}>Copy saved look link</button>{shareNote && <p role="status">{shareNote}</p>}</div>

    <ul className="custom-look-pieces" aria-label="Costume pieces">
      {look.pieces.map(({ piece, item }, index) => <li className="custom-look-piece" key={item?.pieceId ?? `${piece.slot}:${index}`}>
        <div className={`custom-look-photo${item ? "" : " is-missing"}`}>
          {item
            // eslint-disable-next-line @next/next/no-img-element -- real merchant photographs use independent shop CDNs
            ? <a href={item.productUrl} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true"><img src={item.image} alt="" referrerPolicy="no-referrer" loading={index > 2 ? "lazy" : "eager"} /></a>
            : <span>{look.state === "running" ? "Searching…" : "No verified product found"}</span>}
        </div>
        <div className="custom-look-piece-info">
          <h2>{piece.name}</h2>
          {item ? <>
            <a className="custom-look-product" href={item.productUrl} target="_blank" rel="noopener noreferrer">{item.title} <span aria-hidden="true">↗</span></a>
            <div className="custom-look-product-price"><span>{item.merchantName}</span><span>{formatPrice(item.priceCents)}</span></div>
            {ready && item.sizeKind !== "one_size" && (item.availableSizes.length > 0
              ? <select aria-label={`Size for ${piece.name}`} value={sizeOf(item) ?? ""} onChange={(event) => chooseSize(item, event.target.value)}>
                <option value="">Pick a size</option>
                {item.availableSizes.map((size) => <option value={size} key={size}>{size}</option>)}
              </select>
              : <p className="custom-look-size-note">No confirmed sizes</p>)}
            {ready && <button type="button" className="text-btn" disabled={!cart.ready} onClick={inCart(item) ? () => cart.setOpen(true) : () => { cart.add({ ...item, size: sizeOf(item) }, source); if (Object.hasOwn(sizes, item.productId)) cart.setSize(item.pieceId, sizeOf(item)); }}>{inCart(item) ? "View cart" : "Add to cart"}</button>}
          </> : ready ? <button type="button" className="text-btn" disabled={retrying !== null} onClick={() => void retryPiece(index)}>{retrying === index ? "Searching this piece…" : "Search this piece again"}</button> : null}
        </div>
      </li>)}
    </ul>

    {ready && found.length > 0 && <details className="custom-look-preview">
      <summary>See these pieces on you</summary>
      <p>Preview the exact saved products. Your photo and preview stay temporary.</p>
      <PhoneCameraProvider><VirtualTryOn savedLookId={look.id} name={look.name} image={found[0]?.image} totalCents={total}
        selection={found.map(item => ({ pieceId: item.pieceId, productId: item.productId }))}
        pieces={found.map(item => ({ id: item.pieceId, name: item.pieceName }))} /></PhoneCameraProvider>
    </details>}

    {ready && found.length > 0 && <div className="custom-look-actions">
      <p>{missing > 0 ? `${missing} ${missing === 1 ? "piece has" : "pieces have"} no verified product. ` : ""}Prices and stock are checked again at checkout.</p>
      <button type="button" className="btn" disabled={!cart.ready} onClick={allInCart ? () => cart.setOpen(true) : addFound}>{allInCart ? "View cart" : `Add found pieces · ${formatPrice(total)}`}</button>
    </div>}
  </div>;
}
