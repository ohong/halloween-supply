import { describe, expect, test } from "bun:test";
import { absoluteImageUrl, buildSessionParams, lineSummary, totalCents, type SessionLine } from "../session-params";

const line = (n: number, over: Partial<SessionLine> = {}): SessionLine => ({
  pieceId: `piece-${n}`,
  pieceName: `Piece ${n}`,
  productId: `prod-${n}`,
  title: `Product title ${n}`,
  merchantId: `merchant-${n}`,
  merchantName: `Merchant ${n}`,
  productUrl: `https://merchant${n}.example/p/${n}`,
  image: `/products/p${n}.jpg`,
  size: n % 2 ? "M" : null,
  priceCents: 1000 * n + 99,
  priceUnverified: n === 3,
  ...over,
});

const lines = [1, 2, 3, 4, 5].map((n) => line(n));
const params = buildSessionParams({ origin: "https://halloween.supply", costumeSlug: "cosmic-cowboy", lines });

describe("buildSessionParams", () => {
  test("payment mode, one line per piece, quantity 1, USD cents", () => {
    expect(params.mode).toBe("payment");
    expect(params.line_items).toHaveLength(5);
    params.line_items!.forEach((li, i) => {
      expect(li.quantity).toBe(1);
      expect(li.price_data?.currency).toBe("usd");
      expect(li.price_data?.unit_amount).toBe(lines[i].priceCents);
    });
  });

  test("total is exactly the sum of merchant prices (no fee, markup or shipping line)", () => {
    const sum = params.line_items!.reduce((s, li) => s + (li.price_data!.unit_amount as number), 0);
    expect(sum).toBe(totalCents(lines));
    expect(sum).toBe(lines.reduce((s, l) => s + l.priceCents, 0));
    expect(params.shipping_options).toBe(undefined);
  });

  test("product data: name, merchant description, absolute https image", () => {
    const pd = params.line_items![0].price_data!.product_data!;
    expect(pd.name).toBe("Piece 1 — Product title 1");
    expect(pd.description).toBe("Merchant 1");
    expect(pd.images).toEqual(["https://halloween.supply/products/p1.jpg"]);
  });

  test("line-item metadata carries piece, product, merchant, url, size and price flag", () => {
    expect(params.line_items![2].price_data!.product_data!.metadata).toEqual({
      piece_id: "piece-3",
      piece_name: "Piece 3",
      product_id: "prod-3",
      merchant_id: "merchant-3",
      merchant_name: "Merchant 3",
      product_url: "https://merchant3.example/p/3",
      size: "M",
      price_unverified: "true",
    });
    expect(params.line_items![1].price_data!.product_data!.metadata!.size).toBe("one size");
    expect(params.line_items![0].price_data!.product_data!.metadata!.price_unverified).toBe("false");
  });

  test("session metadata: costume slug and a compact line summary, within Stripe limits", () => {
    const md = params.metadata!;
    expect(md.costume_slug).toBe("cosmic-cowboy");
    expect(md.line_1).toBe("Merchant 1 | https://merchant1.example/p/1 | M");
    expect(md.line_2).toBe("Merchant 2 | https://merchant2.example/p/2 | one size");
    expect(md.line_3).toBe("Merchant 3 | https://merchant3.example/p/3 | M | price unverified");
    expect(Object.keys(md).length).toBeLessThan(51);
    for (const v of Object.values(md) as string[]) expect(v.length).toBeLessThan(501);
  });

  test("long URLs are clipped to the 500-char limit", () => {
    const long = line(1, { productUrl: "https://x.example/" + "a".repeat(900) });
    expect(lineSummary(long).length).toBeLessThan(501);
    const p = buildSessionParams({ origin: "https://halloween.supply", costumeSlug: "c", lines: [long] });
    expect((p.line_items![0].price_data!.product_data!.metadata!.product_url as string).length).toBeLessThan(501);
  });

  test("US shipping collection and URLs", () => {
    expect(params.shipping_address_collection).toEqual({ allowed_countries: ["US"] });
    expect(params.success_url).toBe("https://halloween.supply/success?session_id={CHECKOUT_SESSION_ID}");
    expect(params.cancel_url).toBe("https://halloween.supply/costumes/cosmic-cowboy");
  });

  test("trailing slash on origin is tolerated", () => {
    const p = buildSessionParams({ origin: "https://halloween.supply/", costumeSlug: "c", lines: [lines[0]] });
    expect(p.success_url).toBe("https://halloween.supply/success?session_id={CHECKOUT_SESSION_ID}");
  });
});

describe("absoluteImageUrl", () => {
  test("relative paths take the origin; remote https is kept", () => {
    expect(absoluteImageUrl("/products/x.jpg", "https://halloween.supply")).toBe("https://halloween.supply/products/x.jpg");
    expect(absoluteImageUrl("https://cdn.example/a.jpg", "https://halloween.supply")).toBe("https://cdn.example/a.jpg");
  });
  test("non-https images are skipped, and the line has no images key", () => {
    expect(absoluteImageUrl("http://cdn.example/a.jpg", "https://halloween.supply")).toBeNull();
    expect(absoluteImageUrl("/products/x.jpg", "http://localhost:3000")).toBeNull();
    const p = buildSessionParams({ origin: "http://localhost:3000", costumeSlug: "c", lines: [lines[0]] });
    expect(p.line_items![0].price_data!.product_data!.images).toBe(undefined);
  });
});
