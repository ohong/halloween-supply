import { describe, expect, test } from "bun:test";
import { buildSerpUrl, parseSerpPayload, SAN_FRANCISCO_UULE, uuleFor } from "../../../lib/brightdata/client";
import { canonicalUrl, looksLikeProductUrl } from "../search";

describe("parseSerpPayload", () => {
  test("organic only (no shopping array)", () => {
    const r = parseSerpPayload("q", {
      general: { query: "q" },
      organic: [
        { rank: 1, link: "https://a.example/p", title: "A", description: "desc" },
        { link: "https://b.example/p" }, // no title: dropped
      ],
    });
    expect(r.shopping).toEqual([]);
    expect(r.organic).toEqual([{ title: "A", link: "https://a.example/p", description: "desc" }]);
  });

  test("shopping with price strings, numbers and alternate keys", () => {
    const r = parseSerpPayload("q", {
      shopping: [
        { title: "Hat", link: "https://etsy.com/listing/1/x", price: "$1,048.00", shop: "DesertShop", image: "https://img/1.jpg" },
        { name: "Boots", url: "https://b.example/boots", extracted_price: 189.5, price: "$189.50", source: "B" },
        { title: "NoPrice", link: "https://c.example/p" },
        { title: "NoLink" },
        "garbage",
      ],
      organic_results: [{ url: "https://o.example/", name: "O", snippet: "s" }],
    });
    expect(r.shopping.map((s) => s.priceCents)).toEqual([104800, 18950, undefined]);
    expect(r.shopping[0]).toMatchObject({ source: "DesertShop", image: "https://img/1.jpg", price: "$1,048.00" });
    expect(r.organic[0]).toEqual({ title: "O", link: "https://o.example/", description: "s" });
  });

  test("envelope with stringified body, google redirect links", () => {
    const body = JSON.stringify({
      shopping: { items: [{ title: "T", link: "https://www.google.com/url?q=https%3A%2F%2Fm.example%2Fp&sa=U", price: { value: 12 } }] },
    });
    const r = parseSerpPayload("q", { status_code: 200, body });
    expect(r.shopping).toHaveLength(1);
    expect(r.shopping[0].link).toBe("https://m.example/p");
    expect(r.shopping[0].priceCents).toBe(1200);
  });

  test("garbage payloads yield empty results", () => {
    for (const p of [null, undefined, "not json", 42, [], {}]) {
      expect(parseSerpPayload("q", p)).toEqual({ query: "q", shopping: [], organic: [] });
    }
  });
});

describe("serp url", () => {
  test("uule matches the known Lagos example", () => {
    expect(uuleFor("Lagos,Lagos,Nigeria")).toBe("w+CAIQICITTGFnb3MsTGFnb3MsTmlnZXJpYQ");
  });
  test("shopping adds udm=28 or tbm=shop", () => {
    const u = new URL(buildSerpUrl("silver hat", { shopping: true }));
    expect(u.searchParams.get("udm")).toBe("28");
    expect(u.searchParams.get("brd_json")).toBe("1");
    expect(u.searchParams.get("gl")).toBe("us");
    expect(u.searchParams.get("uule")).toBe(SAN_FRANCISCO_UULE);
    expect(new URL(buildSerpUrl("x", { shopping: true, shoppingMode: "tbm" })).searchParams.get("tbm")).toBe("shop");
    expect(new URL(buildSerpUrl("x")).searchParams.has("udm")).toBe(false);
  });
});

describe("candidate url helpers", () => {
  test("canonicalUrl strips tracking and www", () => {
    expect(canonicalUrl("https://www.etsy.com/listing/1/x?utm_source=g&ref=sr#top")).toBe("https://etsy.com/listing/1/x");
  });
  test("looksLikeProductUrl", () => {
    expect(looksLikeProductUrl("https://etsy.com/listing/123/hat")).toBe(true);
    expect(looksLikeProductUrl("https://etsy.com/shop/Foo")).toBe(false);
    expect(looksLikeProductUrl("https://etsy.com/search?q=hat")).toBe(false);
    expect(looksLikeProductUrl("https://w.example/collections/hats")).toBe(false);
    expect(looksLikeProductUrl("https://w.example/collections/hats/products/silver")).toBe(true);
    expect(looksLikeProductUrl("https://w.example/")).toBe(false);
  });
});
