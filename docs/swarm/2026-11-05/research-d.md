# Completion kits D

Reviewed on November 5, 2026, Pacific time (November 6 UTC). Research uses Codex built-in web search and primary pages. No catalog, database, or paid API was changed.

## Choice and trade-offs

Two approaches were considered for each costume. Buying every catalog garment gives a closer clothing match, but adds size decisions and cost. Reusing named black separates and shoes keeps the defining craft pieces while lowering the purchase subtotal. These kits use the second approach. Ownership is an explicit assumption, not a verified fact about a shopper.

For the cloud, keeping the umbrella, white tufts, silver rain, and small bolt preserves each required piece. All four selected purchases are the least expensive catalog matches. One 12-ounce stuffing bag means scattered coverage. A fuller cloud needs more stuffing and raises the price.

For the plant, the $6 half-yard felt cuts are cheaper than the $10.99 acrylic alternatives. The three purchases also share one merchant. This gives a muted soft shoulder collar, not the larger sculpted image. The plan fits one green half-yard, one orange half-yard, and a white sheet; fit the paper layout before cutting.

## Catalog purchase math

All amounts are USD. These are product subtotals, excluding shipping, tax, tools, consumables, and any clothes the shopper lacks. Each purchase has quantity one.

| Kit | Catalog pieces purchased | Purchase subtotal | Owned catalog pieces | Lowest full catalog subtotal | Default full catalog subtotal |
| --- | --- | ---: | --- | ---: | ---: |
| Walking Thundercloud | Umbrella $25 + fiberfill $8.49 + silver yard $4.99 + pin $8.95 | $47.43 | Black base; dark shoes also named outside catalog | $90.42 | $133.48 |
| Venus Flytrap | Sage half-yard $6 + Pumpkin half-yard $6 + White 9x12 $1.50 | $13.50 | Black base and dark shoes | $106.48 | $253.48 |

Every catalog piece is covered exactly once by `buy` or `owned`. Every piece is required, so both `skipped` arrays are empty. The comparison is a purchase-cost reduction through reuse, not a discount on identical products.

## Product evidence and limits

The catalog retains its original stock and price check timestamps. Product evidence timestamps identify this page review, not a successful inventory refresh. Merchant variant endpoints returned HTTP 429 during direct refresh. Built-in web could read base product pages, but not variant-query URLs or public `.js` feeds. Do not describe the selected variants as freshly stock-verified.

| Product ID | Selected variant and catalog price | Primary evidence reviewed | What this review confirms |
| --- | --- | --- | --- |
| `p-b9b3c5ba1f` | White trim, $25 | [SHED RAIN Traditional Bubble](https://shedrain.com/products/auto-open-traditional-bubble) | $25 product page, White option, transparent 52-inch canopy. Generic extracted text includes both “Sold out” and “Add to cart”; exact White inventory is unresolved. |
| `p-a1d82748e7` | 12 oz, $8.49 | [Good's Store Poly Fil](https://goodsstores.com/products/poly-fil-original-pf) | $8.49 page, 12/32 oz choices, polyester fill suitable for decorative cloud scenes. No finished cloud or lights. |
| `p-2d4b62e79e` | Silver, one yard, $4.99 | [Fabric Wholesale Direct Tissue Lame](https://fabricwholesaledirect.com/products/tissue-lame-44-45-inch-fabric) | Silver at $4.99 per yard; 44/45-inch width; thin sheer metallic cloth. Cutting and edge finishing are needed. |
| `p-0265935dc5` | Silver, one pin, free polybag, $8.95 | [StockPins M11](https://stockpins.com/products/lightning-bolt-lapel-pin-1) | $8.95 single-unit price, Silver finish, 3/4 by 1/2 inch bolt, clutch back. Excludes paid box. |
| `p-5168383708` | Sage 1/2 yard, $6 | [Benzie Sage felt](https://www.benziedesign.com/products/sage-wool-blend-felt) | Half-yard option and approximately 36-inch bolt width. Exact $6 variant price remains catalog evidence from October 27; current default $2.50 is a different size. |
| `p-14282b42ef` | Pumpkin 1/2 yard, $6 | [Benzie Pumpkin felt](https://www.benziedesign.com/products/pumpkin-wool-blend-felt) | Pumpkin and half-yard choices. Exact $6 selected-variant price remains catalog evidence from October 27. |
| `p-af9a50034c` | White 9x12, $1.50 | [Benzie White felt](https://www.benziedesign.com/products/white-wool-blend-felt) | 9x12 choice and soft-white material limitation. Exact $1.50 variant price remains catalog evidence from October 27. |

## Shipping and assembly evidence

- [SHED RAIN shipping policy](https://shedrain.com/policies/shipping-policy) does not establish an absolute arrival date for the selected umbrella. Its product page calculates shipping at checkout.
- [Good's Store shipping policy](https://goodsstores.com/policies/shipping-policy) gives 1–3 business days dispatch and checkout delivery estimates. Lower-48 standard shipping for the $8.49 order is listed at $7.99. Online orders can be collected at East Earl, Pennsylvania. That does not establish local pickup for the shopper or the whole kit.
- [Fabric Wholesale Direct shipping help](https://help.fabricwholesaledirect.com/en-US/shipping-319913) separates preparation from transit. It estimates 1–3 business days preparation and 5–7 business days transit, with variation. [Domestic shipping help](https://help.fabricwholesaledirect.com/en-US/domestic-shipping-322407) lists $9.99 shipping under $99 in the lower 48. These fees remain outside the purchase subtotal.
- [StockPins FAQ](https://stockpins.com/pages/faq) allows up to three days to process orders. Overnight shipping does not guarantee next-day receipt.
- [Benzie shipping page](https://www.benziedesign.com/pages/shipping) says most orders dispatch within 24 hours, six days weekly. Delays and carrier transit remain possible. International shipping can take 1–6 weeks. None of this establishes an event-date arrival.
- [The original rain-cloud creator's tutorial](https://spotofteadesigns.com/diy-rain-cloud-costume/) demonstrates a removable fabric backing with hook-and-loop tabs and glued tufts. The author discloses receiving Fairfield product. This is primary assembly evidence from the creator, not a shipping or stock source. The kit adapts it to scattered tufts and silver cloth; no build was physically tested.
- [Fabric Wholesale Direct's product instructions](https://fabricwholesaledirect.com/products/tissue-lame-44-45-inch-fabric) support using a fine needle, lightweight thread, gentle handling, and a scrap test. The plan uses stitched edges rather than assuming cut metallic fabric will not fray.
- [Benzie's felt mobile tutorial](https://www.benziedesign.com/blogs/tutorials/felt-mobile) demonstrates felt leaves, stitching, and soft teeth. The collar pattern is an editorial adaptation, not that mobile's pattern.

Both 120-minute assembly values are explicit estimates. They exclude shipping and shopping. All scissors, needles, thread, pins, fabric backing, hook-and-loop tabs, glue, and glue gun assumptions are displayed. If the shopper lacks them, the plan costs more. Neither kit has a sourced absolute earliest-arrival date, a confirmed local pickup plan, or a delivery promise. Event dates remain general, rather than assuming the past Halloween date.

## Verification

Validation checks both JSON objects against the final `KitDefinition` fields, existing costume/piece/product IDs, product-to-piece matches, quantity one, full single-disposition coverage, per-purchase product evidence, and integer-cent math. The check confirms $47.43 and $13.50 purchase subtotals, both under $100 before excluded costs. No Next.js behavior was changed or exercised; no qualifying Next.js feedback candidate was observed.
