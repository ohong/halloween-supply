import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { getStripe, isStripeConfigured } from "@/lib/checkout/stripe";
import { formatPrice } from "@/lib/cart/context";
import { ClearCart } from "./clear-cart";

export const metadata: Metadata = { title: "Order received — Halloween Supply", robots: { index: false } };

interface OrderLine {
  name: string;
  merchant: string | null;
  cents: number;
}
interface Order {
  email: string | null;
  lines: OrderLine[];
  totalCents: number;
}

async function loadOrder(sessionId: string | undefined): Promise<Order | null> {
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId) || !isStripeConfigured()) return null;
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId, { expand: ["line_items.data.price.product"] });
    if (session.payment_status === "unpaid") return null;
    return {
      email: session.customer_details?.email ?? session.customer_email ?? null,
      lines: (session.line_items?.data ?? []).map((l) => {
        const product = l.price?.product;
        const merchant = product && typeof product === "object" && "description" in product ? product.description : null;
        return { name: l.description ?? "Item", merchant, cents: l.amount_total };
      }),
      totalCents: session.amount_total ?? 0,
    };
  } catch (e) {
    console.error("[success] could not retrieve session", e);
    return null;
  }
}

async function OrderDetails({ searchParams }: { searchParams: Promise<{ session_id?: string | string[] }> }) {
  await connection(); // per-request Stripe lookup
  const { session_id } = await searchParams;
  const order = await loadOrder(Array.isArray(session_id) ? session_id[0] : session_id);

  return (
    <>
      <p className="mt-4 text-[15px] leading-relaxed opacity-70">
        {order?.email ? <>A receipt is on its way to {order.email}. </> : null}
        A concierge will now place each order with its shop and keep you posted.
      </p>
      {order && order.lines.length > 0 ? (
        <div className="mt-10 border-t border-black/10">
          <ul>
            {order.lines.map((line, i) => (
              <li key={i} className="flex items-baseline justify-between gap-6 border-b border-black/10 py-4 text-[15px]">
                <span>
                  {line.name}
                  {line.merchant ? <span className="block text-[13px] opacity-60">from {line.merchant}</span> : null}
                </span>
                <span className="tabular-nums">{formatPrice(line.cents)}</span>
              </li>
            ))}
          </ul>
          <p className="flex items-baseline justify-between py-4 text-[15px] font-medium">
            <span>Total</span>
            <span className="tabular-nums">{formatPrice(order.totalCents)}</span>
          </p>
        </div>
      ) : null}
    </>
  );
}

export default function SuccessPage({ searchParams }: { searchParams: Promise<{ session_id?: string | string[] }> }) {
  return (
    <main id="main" className="mx-auto w-full max-w-xl px-4 py-24">
      <ClearCart />
      <h1 className="text-[34px] font-normal leading-tight tracking-tight">Order received</h1>
      <Suspense
        fallback={
          <p className="mt-4 text-[15px] leading-relaxed opacity-70">
            A concierge will now place each order with its shop and keep you posted.
          </p>
        }
      >
        <OrderDetails searchParams={searchParams} />
      </Suspense>
      <Link href="/" className="mt-12 inline-block border-b border-black/20 py-2 text-[13px]">
        Back to the costumes
      </Link>
    </main>
  );
}
