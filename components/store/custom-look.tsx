"use client";

import { useState } from "react";
import Link from "next/link";
import { formatPrice, useCart } from "@/lib/cart/context";
import type { CustomLook } from "@/lib/custom-looks/types";
import type { CartItem } from "@/lib/types";
import "./custom-look.css";

export function CustomLookView({ look }: { look: CustomLook }) {
  const cart = useCart();
  const [sizes, setSizes] = useState<Record<string, string | null>>({});
  const source = `custom-look:${look.id}`;
  const found = look.pieces.flatMap(({ item }) => item ? [item] : []);
  const missing = look.pieces.length - found.length;
  const total = found.reduce((sum, item) => sum + item.priceCents, 0);
  const ready = look.state === "complete" || look.state === "partial";
  const inCart = (item: CartItem) => cart.costumeSlug === source && cart.items.some((line) => line.pieceId === item.pieceId);
  const sizeOf = (item: CartItem) => (cart.costumeSlug === source ? cart.items.find((line) => line.pieceId === item.pieceId)?.size : null) ?? sizes[item.pieceId] ?? item.size;
  const allInCart = found.length > 0 && found.every(inCart);

  function chooseSize(item: CartItem, value: string) {
    const size = value || null;
    setSizes((current) => ({ ...current, [item.pieceId]: size }));
    if (inCart(item)) cart.setSize(item.pieceId, size);
  }

  function addFound() {
    cart.addMany(found.map((item) => ({ ...item, size: sizeOf(item) })), source);
    cart.setOpen(true);
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
            {ready && <button type="button" className="text-btn" onClick={inCart(item) ? () => cart.setOpen(true) : () => cart.add({ ...item, size: sizeOf(item) }, source)}>{inCart(item) ? "View cart" : "Add to cart"}</button>}
          </> : null}
        </div>
      </li>)}
    </ul>

    {ready && found.length > 0 && <div className="custom-look-actions">
      <p>{missing > 0 ? `${missing} ${missing === 1 ? "piece has" : "pieces have"} no verified product. ` : ""}Prices and stock are checked again at checkout.</p>
      <button type="button" className="btn" onClick={allInCart ? () => cart.setOpen(true) : addFound}>{allInCart ? "View cart" : `Add found pieces · ${formatPrice(total)}`}</button>
    </div>}
  </div>;
}
