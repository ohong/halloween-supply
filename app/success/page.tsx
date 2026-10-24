import Link from "next/link";
import { Suspense } from "react";
import { getStripe } from "@/lib/checkout/stripe";

export const metadata = { title: "Order received — Halloween Supply" };

const money = (cents: number | null) => `$${((cents ?? 0) / 100).toFixed(2)}`;

type SuccessProps = { searchParams: Promise<{ session_id?: string | string[] }> };

export default function SuccessPage(props: SuccessProps) {
  return <Suspense fallback={<main id="main" className="px-5 py-20 text-center text-sm text-[#666]">Checking your payment…</main>}><OrderDetails {...props} /></Suspense>;
}

async function OrderDetails({ searchParams }: SuccessProps) {
  const { session_id } = await searchParams;
  const id = Array.isArray(session_id) ? session_id[0] : session_id;

  let session = null;
  let error: string | null = null;
  if (!id || !/^cs_(?:test|live)_[A-Za-z0-9]{10,200}$/.test(id)) {
    error = "No order was specified.";
  } else {
    try {
      session = await getStripe().checkout.sessions.retrieve(id, {
        expand: ["line_items.data.price.product"],
      });
      if (session.metadata?.costume === undefined) {
        session = null;
        error = "We could not find that order.";
      }
    } catch {
      console.error("[success] could not retrieve the checkout session");
      error = "We could not find that order.";
    }
  }

  const shipping = session?.collected_information?.shipping_details;
  const addr = shipping?.address;
  const paid = session?.status === "complete" && session.payment_status === "paid";

  return (
    <main id="main" style={{ background: "#FFF", color: "#333", minHeight: "100vh" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "80px 20px" }}>
        {error || !session ? (
          <>
            <h1 style={{ fontSize: 28, fontWeight: 300, letterSpacing: "0.01em", margin: 0 }}>Order not found</h1>
            <p style={{ color: "#666", marginTop: 12 }}>{error}</p>
          </>
        ) : !paid ? (
          <>
            <h1 style={{ fontSize: 28, fontWeight: 300, letterSpacing: "0.01em", margin: 0 }}>Payment not completed</h1>
            <p style={{ color: "#666", marginTop: 12 }}>
              {session.status === "complete" ? "Your payment is still processing. Check this page again shortly." : "This checkout has not been paid. Return to your costume to continue."}
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 28, fontWeight: 300, letterSpacing: "0.01em", margin: 0 }}>Order received</h1>
            <p style={{ color: "#666", marginTop: 12 }}>
              Thanks{session.customer_details?.name ? `, ${session.customer_details.name}` : ""}. Your payment is confirmed.
              {session.customer_details?.email ? ` Your order email is ${session.customer_details.email}.` : ""}
            </p>

            <ul style={{ listStyle: "none", padding: 0, margin: "40px 0 0", borderTop: "1px solid #CCC" }}>
              {session.line_items?.data.map((li) => {
                const product = li.price?.product;
                const meta = typeof product === "object" && product && "metadata" in product ? product.metadata : {};
                return (
                  <li key={li.id} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "16px 0", borderBottom: "1px solid #CCC" }}>
                    <div>
                      <div>{li.description}</div>
                      <div style={{ color: "#666", fontSize: 14, marginTop: 4 }}>
                        {meta.merchant ? `From ${meta.merchant}` : null}
                        {meta.size && meta.size !== "one size" ? ` · Size ${meta.size}` : null}
                      </div>
                    </div>
                    <div>{money(li.amount_total)}</div>
                  </li>
                );
              })}
              <li style={{ display: "flex", justifyContent: "space-between", padding: "16px 0" }}>
                <span>Total</span>
                <span>{money(session.amount_total)}</span>
              </li>
            </ul>

            {addr ? (
              <section style={{ marginTop: 32 }}>
                <h2 style={{ fontSize: 14, fontWeight: 400, color: "#666", margin: 0 }}>Shipping to</h2>
                <p style={{ margin: "8px 0 0", lineHeight: 1.5 }}>
                  {shipping?.name}
                  <br />
                  {addr.line1}
                  {addr.line2 ? <><br />{addr.line2}</> : null}
                  <br />
                  {addr.city}, {addr.state} {addr.postal_code}
                </p>
              </section>
            ) : null}

            <p style={{ color: "#666", marginTop: 32, lineHeight: 1.5 }}>
              Our concierge will order each piece from its shop. Pieces may arrive separately. Delivery by October 31 is not guaranteed.
            </p>
          </>
        )}
        <Link
          href="/"
          style={{ display: "inline-block", marginTop: 40, background: "#111", color: "#FFF", padding: "12px 20px", borderRadius: 4, textDecoration: "none" }}
        >
          Back to the costumes
        </Link>
      </div>
    </main>
  );
}
