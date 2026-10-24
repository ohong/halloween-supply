import { describe, expect, test } from "bun:test";
import { extractMerchantHints } from "../../../lib/products/hints";
import { parseProduct } from "../../../lib/products/parse";
import { parsePriceToCents } from "../../../lib/products/price";

const shopify = `<!doctype html><html><head>
<title>Silver Sequin Fringe Jacket &ndash; Wild West Co</title>
<meta property="og:site_name" content="Wild West Co">
<meta property="og:image" content="//cdn.example.com/og.jpg">
<script type="application/ld+json">
{"@context":"http://schema.org/","@type":"ProductGroup","name":"Silver Sequin Fringe Jacket","description":"<p>Sequin &amp; fringe, fully lined.</p>",
 "url":"https://wildwest.example/products/silver-fringe-jacket","productGroupID":"123","variesBy":["https://schema.org/size"],
 "hasVariant":[
  {"@type":"Product","name":"S","size":"S","image":"https://cdn.example.com/s.jpg","offers":{"@type":"Offer","price":"128.00","priceCurrency":"USD","availability":"https://schema.org/InStock"}},
  {"@type":"Product","name":"M","size":"M","offers":{"@type":"Offer","price":"128.00","priceCurrency":"USD","availability":"https://schema.org/InStock"}},
  {"@type":"Product","name":"L","size":{"@type":"QuantitativeValue","value":"L"},"offers":{"@type":"Offer","price":"128.00","priceCurrency":"USD","availability":"https://schema.org/OutOfStock"}}
 ]}
</script></head><body>x</body></html>`;

const etsy = `<html><head>
<script type="application/ld+json">
[{"@context":"https://schema.org","@graph":[
 {"@type":"BreadcrumbList","itemListElement":[]},
 {"@type":"Product","@id":"#p","name":"Vintage 70s Silver Metallic Cowboy Hat","brand":{"@type":"Brand","name":"DesertSonsVintage"},
  "image":[{"@type":"ImageObject","url":"https://i.etsystatic.com/1/r/il/abc/1_fullxfull.jpg"},"https://i.etsystatic.com/1/r/il/abc/2_fullxfull.jpg"],
  "offers":{"@type":"AggregateOffer","lowPrice":"1,249.50","highPrice":"1,300","priceCurrency":"USD","offerCount":2,
    "offers":[{"@type":"Offer","price":"1249.50","priceCurrency":"USD","availability":"https://schema.org/InStock"}]}}
]}]
</script></head><body><p>Ships from Oakland, CA. Shop location: Oakland, California</p></body></html>`;

const ogOnly = `<html><head><title>Fringe Scarf</title>
<meta property="og:title" content="Blue Silk Neckerchief">
<meta property="og:description" content="Hand-dyed &quot;cosmic&quot; blue silk.">
<meta property="og:image" content="https://shop.example/img/neck.jpg">
<meta property="product:price:amount" content="24.00">
<meta property="product:price:currency" content="usd">
<meta property="og:availability" content="out of stock">
</head><body></body></html>`;

const noData = `<html><head><title>Welcome</title></head><body><h1>Our shop</h1><p>Hello</p></body></html>`;

describe("parseProduct", () => {
  test("Shopify ProductGroup with variants", () => {
    const p = parseProduct(shopify, "https://wildwest.example/products/silver-fringe-jacket");
    expect(p.via).toBe("json-ld");
    expect(p.title).toBe("Silver Sequin Fringe Jacket");
    expect(p.priceCents).toBe(12800);
    expect(p.currency).toBe("USD");
    expect(p.availability).toBe("in_stock");
    expect(p.sizes).toEqual(["S", "M"]); // L is out of stock
    expect(p.images).toContain("https://cdn.example.com/s.jpg");
    expect(p.images).toContain("https://cdn.example.com/og.jpg"); // protocol-relative OG resolved
    expect(p.description).toBe("Sequin & fringe, fully lined.");
  });

  test("Etsy-style @graph with AggregateOffer and string prices", () => {
    const p = parseProduct(etsy, "https://www.etsy.com/listing/1/vintage-hat");
    expect(p.via).toBe("json-ld");
    expect(p.priceCents).toBe(124950);
    expect(p.availability).toBe("in_stock");
    expect(p.images).toEqual(["https://i.etsystatic.com/1/r/il/abc/1_fullxfull.jpg", "https://i.etsystatic.com/1/r/il/abc/2_fullxfull.jpg"]);
    const hints = extractMerchantHints(etsy, "https://www.etsy.com/listing/1/vintage-hat");
    expect(hints.brand).toBe("DesertSonsVintage");
    expect(hints.bayAreaMentions).toContain("Oakland");
    expect(hints.locationSnippets.length).toBeGreaterThan(0);
  });

  test("Open Graph only, out of stock", () => {
    const p = parseProduct(ogOnly, "https://shop.example/neck");
    expect(p.via).toBe("open-graph");
    expect(p.title).toBe("Blue Silk Neckerchief");
    expect(p.priceCents).toBe(2400);
    expect(p.currency).toBe("USD");
    expect(p.availability).toBe("out_of_stock");
    expect(p.description).toBe('Hand-dyed "cosmic" blue silk.');
  });

  test("page without structured data", () => {
    const p = parseProduct(noData, "https://x.example/");
    expect(p.via).toBe("none");
    expect(p.priceCents).toBeNull();
    expect(p.title).toBe("Welcome");
  });

  test("malformed JSON-LD does not throw and falls back to meta", () => {
    const html = `<script type="application/ld+json">{ not json </script>${ogOnly}`;
    expect(parseProduct(html, "https://shop.example/neck").via).toBe("open-graph");
  });

  test("offers as array, picks lowest in-stock", () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"Boots","offers":[
      {"@type":"Offer","price":99,"priceCurrency":"USD","availability":"SoldOut"},
      {"@type":"Offer","price":"189.00","priceCurrency":"USD","availability":"https://schema.org/InStock"},
      {"@type":"Offer","price":"210.00","priceCurrency":"USD","availability":"https://schema.org/InStock"}]}</script>`;
    const p = parseProduct(html, "https://b.example/p");
    expect(p.priceCents).toBe(18900);
    expect(p.availability).toBe("in_stock");
  });
});

describe("parsePriceToCents", () => {
  test.each([
    ["$48.00", 4800],
    ["$1,234.50", 123450],
    ["From $48 - $60", 4800],
    ["USD 48", 4800],
    ["48,00", 4800],
    ["1.234,50", 123450],
    [48, 4800],
    [19.99, 1999],
  ])("%p", (input, cents) => expect(parsePriceToCents(input)).toBe(cents));
  test("unparseable", () => {
    expect(parsePriceToCents("Free")).toBeNull();
    expect(parsePriceToCents(null)).toBeNull();
  });
});
