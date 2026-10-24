"use client";

import { useEffect } from "react";
import { useCart } from "@/lib/cart/context";

/** Empties the cart once the order is placed. Renders nothing. */
export function ClearCart() {
  const { clear } = useCart();
  useEffect(() => {
    clear();
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
