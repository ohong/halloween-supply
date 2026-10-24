"use client";

import { useEffect } from "react";
import { useCart } from "@/lib/cart/context";

/** Mount only after the server confirms payment, and wait until the stored cart is loaded. */
export function ClearCart() {
  const { clear, ready } = useCart();
  useEffect(() => {
    if (ready) clear();
  }, [clear, ready]);
  return null;
}
