"use client";

import { formatPrice } from "@/lib/cart/context";
import type { ProductCard as Card } from "@/lib/ai/cards";

/** A catalog product inside an assistant reply, with an add-to-cart button. */
export function ProductCard({ card, inCart, onAdd }: { card: Card; inCart: boolean; onAdd: (card: Card) => void }) {
  const soldOut = card.availability === "out_of_stock";
  return (
    <li className="flex gap-3 rounded-[4px] border border-[#CCC] bg-white p-2.5">
      <a
        href={card.url}
        target="_blank"
        rel="noopener noreferrer"
        className="relative block size-16 shrink-0 overflow-hidden rounded-[4px] bg-[#EFEEEF]"
        aria-label={`${card.title} at ${card.merchant} (opens the merchant page)`}
      >
        {/* Remote merchant images have no known host list, so a plain img is used. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={card.image} alt="" className="size-full object-contain" loading="lazy" />
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="line-clamp-2 text-[13px] leading-snug text-[#333]">{card.title}</p>
        <p className="truncate text-xs text-[#666]">
          {card.merchant}
          {card.location ? ` · ${card.location}` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] text-[#333]">{formatPrice(card.priceCents)}</span>
          <Tag>{card.priceTier}</Tag>
          {card.isLocal && <Tag>Support local</Tag>}
          {soldOut && <Tag>Sold out</Tag>}
        </div>
        <button
          type="button"
          disabled={inCart || soldOut}
          onClick={() => onAdd(card)}
          className="mt-0.5 min-h-11 self-start rounded-[4px] bg-[#111] px-3 text-xs text-white transition-colors duration-150 hover:bg-[#333] active:opacity-75 disabled:bg-[#EFEEEF] disabled:text-[#666]"
        >
          {inCart ? "In cart" : "Add to cart"}
        </button>
      </div>
    </li>
  );
}

function Tag({ children }: { children: string }) {
  return <span className="rounded-full bg-[#EFEEEF] px-2 py-0.5 text-[11px] leading-none text-[#333]">{children}</span>;
}
