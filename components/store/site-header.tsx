"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart/context";

export function SiteHeader() {
  const { items, ready, setOpen } = useCart();
  return <header className="site-header page">
    <Link href="/" className="wordmark">halloween.supply</Link>
    <button type="button" className="btn btn-small" onClick={() => setOpen(true)} aria-haspopup="dialog">
      Cart{ready && items.length > 0 && <span className="cart-count" aria-label={`${items.length} pieces`}>{items.length}</span>}
    </button>
  </header>;
}
