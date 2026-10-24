import { describe, expect, test } from "bun:test";
import { recheckAll, recheckOne, type PageFetcher } from "../recheck";

const page = (price: string, availability = "InStock") =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Silver hat",
    offers: { "@type": "Offer", price, priceCurrency: "USD", availability: `https://schema.org/${availability}` },
  })}</script></head><body></body></html>`;

const input = (over: Partial<{ pieceId: string; url: string; storedCents: number }> = {}) => ({
  pieceId: "cowboy-hat",
  pieceName: "Silver cowboy hat",
  url: "https://shop.test/hat",
  storedCents: 4800,
  ...over,
});

describe("recheckOne", () => {
  test("unchanged price is verified with no PriceChange", async () => {
    const r = await recheckOne(input(), async () => page("48.00"));
    expect(r.priceCents).toBe(4800);
    expect(r.priceUnverified).toBe(false);
    expect(r.priceChange).toBeNull();
    expect(r.availability).toBe("in_stock");
  });

  test("changed price uses the new price and records a PriceChange", async () => {
    const r = await recheckOne(input(), async () => page("52.50"));
    expect(r.priceCents).toBe(5250);
    expect(r.priceUnverified).toBe(false);
    expect(r.priceChange).toEqual({ pieceId: "cowboy-hat", pieceName: "Silver cowboy hat", oldCents: 4800, newCents: 5250 });
  });

  test("out of stock is reported", async () => {
    const r = await recheckOne(input(), async () => page("48.00", "OutOfStock"));
    expect(r.availability).toBe("out_of_stock");
  });

  test("a fetcher that rejects (timeout) falls back to the stored price, unverified", async () => {
    const r = await recheckOne(input(), async () => {
      throw new Error("The operation timed out");
    });
    expect(r.priceCents).toBe(4800);
    expect(r.priceUnverified).toBe(true);
    expect(r.priceChange).toBeNull();
  });

  test("a fetcher that never resolves is cut off by the deadline", async () => {
    const hang: PageFetcher = () => new Promise(() => {});
    const started = Date.now();
    const r = await recheckOne(input(), hang, 50);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(r.priceUnverified).toBe(true);
    expect(r.priceCents).toBe(4800);
  });

  test("a page with no price is unverified at the stored price", async () => {
    const r = await recheckOne(input(), async () => "<html><body>hello</body></html>");
    expect(r.priceUnverified).toBe(true);
    expect(r.priceCents).toBe(4800);
  });

  test("a non-USD price is not trusted", async () => {
    const html = page("48.00").replace('"USD"', '"EUR"');
    const r = await recheckOne(input(), async () => html);
    expect(r.priceUnverified).toBe(true);
    expect(r.priceCents).toBe(4800);
  });
});

describe("recheckAll", () => {
  test("runs in parallel and keeps input order", async () => {
    const delays: Record<string, number> = { "https://a.test": 120, "https://b.test": 10 };
    const fetcher: PageFetcher = async (url) => {
      await new Promise((r) => setTimeout(r, delays[url]));
      return page(url === "https://a.test" ? "10.00" : "20.00");
    };
    const started = Date.now();
    const out = await recheckAll(
      [input({ pieceId: "a", url: "https://a.test", storedCents: 1000 }), input({ pieceId: "b", url: "https://b.test", storedCents: 1500 })],
      fetcher,
    );
    expect(Date.now() - started).toBeLessThan(220);
    expect(out.map((o) => o.pieceId)).toEqual(["a", "b"]);
    expect(out[0].priceChange).toBeNull();
    expect(out[1].priceChange?.newCents).toBe(2000);
  });
});
