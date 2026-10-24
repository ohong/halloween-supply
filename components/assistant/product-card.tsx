"use client";

import Image from "next/image";
import { formatPrice } from "@/lib/cart/context";
import type { ProductOption } from "@/lib/types";

export function ProductCard({ option, inCart, onAdd }: { option: ProductOption; inCart: boolean; onAdd: () => void }) {
  const { product, merchant, pick } = option;
  return (
    <article className="flex w-[200px] shrink-0 snap-start flex-col rounded-[4px] border border-[#CCC] bg-white">
      <div className="relative aspect-square bg-[#EFEEEF]">
        <Image
          src={product.image}
          alt={product.title}
          fill
          unoptimized
          sizes="200px"
          className="object-contain p-3 mix-blend-multiply"
        />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <a
          href={product.url}
          target="_blank"
          rel="noreferrer"
          className="line-clamp-2 text-[13px] leading-[1.35] text-[#333] transition-colors duration-150 ease-in-out hover:text-[#666]"
        >
          {product.title}
        </a>
        <div className="text-[12px] text-[#666]">{merchant.name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-[14px] text-[#333]">{formatPrice(product.priceCents)}</span>
          {pick.isLocal && (
            <span className="rounded-full bg-[#EFEEEF] px-2 py-[2px] text-[11px] text-[#333]">Local</span>
          )}
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={inCart}
          className="mt-2 min-h-[40px] rounded-[4px] bg-[#111] px-3 text-[13px] text-white transition-colors duration-150 ease-in-out hover:bg-[#333] disabled:bg-[#EFEEEF] disabled:text-[#666]"
        >
          {inCart ? "In cart" : "Add to cart"}
        </button>
      </div>
    </article>
  );
}
