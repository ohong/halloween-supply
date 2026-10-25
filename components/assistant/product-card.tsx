"use client";

import { CheckIcon, PlusIcon } from "lucide-react";
import { formatPrice } from "@/lib/cart/context";
import type { ProductCard as Card } from "@/lib/ai/cards";

/** A catalog product row inside an assistant reply, with a compact add control. */
export function ProductCard({ card, inCart, onAdd }: { card: Card; inCart: boolean; onAdd: (card: Card) => void }) {
  const soldOut = card.availability === "out_of_stock";
  const notes = [card.priceTier, card.isLocal ? "Local" : null, soldOut ? "Sold out" : null].filter(Boolean).join(" · ");
  return (
    <li className="ai-product">
      <a
        href={card.url}
        target="_blank"
        rel="noopener noreferrer"
        className="ai-product-thumb"
        aria-label={`${card.title} at ${card.merchant} (opens the merchant page)`}
      >
        {/* Remote merchant images have no known host list, so a plain img is used. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={card.image} alt="" loading="lazy" />
      </a>
      <div className="min-w-0 flex-1">
        <p className="ai-product-title">{card.title}</p>
        <p className="ai-product-meta">
          {card.merchant}
          {card.location ? ` · ${card.location}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <p className="ai-product-price">
          {formatPrice(card.priceCents)}
          {notes && <span className="sr-only">, {notes}</span>}
        </p>
        <button
          type="button"
          disabled={inCart || soldOut}
          onClick={() => onAdd(card)}
          className="ai-product-add"
          aria-label={inCart ? `${card.title} is in your cart` : soldOut ? `${card.title} is sold out` : `Add ${card.title} to cart`}
        >
          {inCart ? <><CheckIcon aria-hidden />In cart</> : soldOut ? "Sold out" : <><PlusIcon aria-hidden />Add</>}
        </button>
      </div>
    </li>
  );
}
