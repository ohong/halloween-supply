# Completion kits: Cosmic Cowboy, Velvet Vampire, Linen Ghost

Research date: November 5, 2026, America/Vancouver. Sources were read with built-in web search and page opening. No Firecrawl, paid API, purchase, or database write was used.

The definitions are in `data/kits/research/a.json`. They add an overlay and leave costume products, prices, stock records, and default match ranks unchanged. Prices below are the existing USD catalog values. Shipping, tax, owned items, tools, and supplies are excluded.

| Kit | New purchases | Purchase subtotal | Required owned items | Estimate to assemble |
| --- | --- | ---: | --- | ---: |
| Cosmic Cowboy | Hat $9.99; jacket $24.99; trousers $39.00; bandana $5.99 | $79.97 | Pointed western boots; base top | 15 minutes |
| Velvet Vampire | Cape $21.99; shirt $22.00; waistcoat $32.45; brooch $21.95 | $98.39 | Black tall boots; black trousers | 15 minutes |
| Linen Ghost | White Queen linen flat sheet $64.99 | $64.99 | Light top and trousers; brown boots; cap; pins; tools | 30 minutes |

These times are planning estimates. No costume was assembled or timed. Every required costume piece is either purchased or explicitly owned. Every optional piece also has an explicit disposition.

## Choices and trade-offs

Cosmic Cowboy could use the lowest catalog trousers at $24.99, making the purchase subtotal $65.96. However, [their merchant page](https://shop.johnniebrocks.com/products/womens-70s-metallic-bell-bottoms) still displays an online-ordering pause. It also has limited silver sizes in the catalog. The chosen $39 satin trousers keep the subtotal below $100 and avoid relying on that ordering state. Satin is less reflective than metallic foil. The $24.99 jacket is L/XL only and has disco-style tinsel fringe. A tailored $71 fringe jacket with the selected trousers would push the new purchases above $100.

Velvet Vampire could reuse a white shirt and black waistcoat for fewer purchases. The selected kit buys the ruffled shirt and brocade waistcoat to preserve the defining visible details. It reuses black trousers and boots. The shirt fits up to a 42-inch chest, so this kit is not a universal-size offer. The $98.39 figure is merchandise only; separate shipping charges can take the order total above $100. The brooch decorates the shirt or waistcoat. It does not replace the cape's own fastening.

Linen Ghost could buy new base layers and boots. Those purchases add little beneath the drape and exceed the budget when combined with the sheet. The selected kit buys only the visible linen. It uses owned pins in place of a decorative shawl pin. White replaces the original natural off-white shade. Cutting changes the sheet permanently, and the assembly instructions require a fitted cap to keep the eye openings aligned.

## Source coverage

All sources below were checked on November 5, 2026. The JSON stores ISO timestamps with the local date and UTC offset. Published processing windows remain separate from delivery estimates. No destination or event date was supplied, so complete-kit delivery remains unconfirmed.

| Source | What it supports | Limit |
| --- | --- | --- |
| [FlashingBlinkyLights hat](https://www.flashingblinkylights.com/silver-sequin-cowboy-hat-with-white-led-brim.html) | One hat costs $9.99; batteries arrive installed; adjustable chin strap and activation instructions | Product-page facts do not confirm delivery |
| [FlashingBlinkyLights shipping](https://www.flashingblinkylights.com/shipping-policy) | In-stock orders received by noon Pacific ship the same business day | No address-specific arrival checked |
| [Odd Assortment jacket](https://theoddassortment.com/products/adult-l-xl-silver-tinsel-fringe-jacket) | $24.99 KBW silver tinsel jacket, adult L/XL | Fit must be checked |
| [Odd Assortment shipping](https://theoddassortment.com/policies/shipping-policy) | Usually ships within 24 hours of cleared payment; weekends can wait until the next business day | No transit window found on that policy |
| [Local Group trousers](https://thelocalgroup.shop/products/metallic-muse-satin-trouser-in-silver) | $39 silver satin trousers; S/M/L/XL; 1–2 business days to process and ship | Processing does not establish arrival; domestic shipping below $99 is listed as $12.95 |
| [Western Express bandana](https://wexpress.com/bandanas-royal-blue-paisley-usa-made/) | $5.99 royal blue bandana, cotton, 22 inches square | Current source path differs from the stored catalog product path; no record changed |
| [Western Express shipping](https://wexpress.com/pages/shipping-information) | Usually dispatches in 1–2 business days; estimated basic USA delivery 5–7 business days, Canada 10–21 | No guaranteed event-date arrival; the policy also contains inconsistent free-shipping thresholds, which are not used |
| [State Fair Seasons cape](https://statefairseasons.com/products/black-velvet-hooded-cape-with-red-satin-lining) | $21.99 Underwraps #30355; black velvet, red satin lining, adult size | No useful merchant-specific arrival window established |
| [Medieval Collectibles shirt](https://www.medievalcollectibles.com/product/ruffled-costume-shirt/) | $22 shirt; front ruffles and lace cuffs; 42-inch chest limit | One standard size |
| [Medieval Collectibles FAQ](https://www.medievalcollectibles.com/faq/) | In-stock dispatch same or next business day; domestic delivery estimate 1–7 business days | International orders can take longer; no checkout-level arrival checked |
| [DarkRock waistcoat](https://www.darkrock.net/products/mens-waistcoat-vest-black-brocade-gothic-steampunk-vtg-usa) | $32.45 brocade waistcoat, S–5XL options, adjustable buckle | No useful merchant-specific arrival window established |
| [Historical Emporium brooch](https://historicalemporium.com/products/sunburst-magnetic-brooch-silver) | $21.95 magnetic silver-tone brooch, about 2.5 inches | Merchant warns of pacemaker interference; no cape-load claim is made |
| [Historical Emporium shipping](https://historicalemporium.com/pages/shipping-options) | USA arrival quote within eight business days standard or five expedited | Excludes holidays and weekends; international service differs |
| [Simple&Opulence sheet](https://www.simpleopulence.com/products/linen-flat-sheet-basic-style) | $64.99 flat sheet, 100% stonewashed linen; white Queen option 90 by 102 inches | Catalog remains the source for the selected variant's stored stock state |
| [Simple&Opulence shipping](https://www.simpleopulence.com/policies/shipping-policy) | 1–2 business days to process; warehouse works Monday through Friday | No address-specific delivery date checked |
| [Howcast sheet-ghost tutorial](https://www.youtube.com/watch?v=rZrLPYFQ5aM) | Cap-and-pin method; mark eye openings and trim hem | Method evidence only; no measured time or fit test for this sheet |

No pickup option is promoted. No source establishes an absolute earliest arrival date, so none is encoded. No October 31 promise is made.

## Verification

The structural validation checks JSON parsing, schema fields, unique slugs, exactly one disposition per costume piece, buy-to-match membership, positive quantities, at least one purchase and owned piece, USD subtotals below $100, HTTPS evidence, and November 5 ISO timestamps. It also confirms that the changed files are limited to this report and the three kit definitions. Application checks belong to the integration pass; none are claimed here.

No Next.js runtime or documentation issue arose during this data-only task, so there is no agent-feedback candidate.
