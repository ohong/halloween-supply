"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart/context";

export function SiteHeader() {
  const { items, ready, setOpen } = useCart();
  const count = ready ? items.length : 0;
  return (
    <header className="site-header">
      <div className="shell site-header-inner">
        <Link href="/" className="wordmark">halloween.supply</Link>
        <button
          type="button"
          className={`cart-button ${count > 0 ? "has-items" : ""}`}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={`Open cart, ${count} ${count === 1 ? "item" : "items"}`}
        >
          Cart <span className="cart-count" aria-hidden="true">{count}</span>
        </button>
      </div>
    </header>
  );
}
