# Costume expansion E

Five shoppable looks: Escaped Masterpiece, Fortune Teller, Alien Botanist, Haunted Bellhop, and Masquerade Sun King. Each component has three distinct priced options. `expansion-e.json` contains the editorial copy and newly checked products. Full snapshots live in `data/costumes/`.

## Research and product images

Built-in web search found primary merchants. Public product variant feeds supplied exact variant prices, orderable sizes, and stock when available. Actual merchant photographs are cached as WebP in `public/products/price-tiers/`. Existing catalog basics retain their original product IDs and evidence dates.

New sources:

- [Cosplay Pros EVA foam](https://www.thecosplaypros.com/products/eva-foam-sheets): stocked black 6, 8, and 10 mm sheets, each 500 × 1500 mm. These are DIY materials rather than finished frames or hats.
- [Caufield’s coin headband set](https://caufields.com/products/gypsy-headband-and-earrings-set) and [blue coin hip scarf](https://caufields.com/products/fortune-teller-coin-hip-scarf-blue-gold): separate accessory styles. Their feeds confirm price and availability.
- [MissBellyDance royal-blue velvet hip scarf](https://missbellydance.com/products/belly-dance-velvet-hip-scarf-with-gold-coins?variant=45950013046996): the product page embeds the available Royal Blue variant and exact photo.
- [The Costume Shop silver antennae](https://www.costume-shop.com/products/14107026): Silver is available; the sold-out Gold variant is excluded. The cached photo shows Silver.
- [Masquerade Store gold halo](https://www.masqueradestore.com/products/gold-sunburst-halo-crown-headwear), [Holly Hardwick gold crown](https://hollyhardwick.com/products/golden-halo-sunburst-crown), and [BABEYOND floral halo](https://babeyond.com/products/floral-sunburst-mary-halo-crown): different gold sunburst designs. BABEYOND’s selected Gold page says In stock, though generic unavailable control text also exists.
- [The Little Bazaar velvet skirt](https://www.thelittlebazaar.com/item/5620.html): live Buy control and limited quantity. A different indexed skirt, item 5455, is visibly sold out and was rejected despite stale in-stock metadata.
- [Liz Maree burgundy skirt](https://lizmareeboutique.com/products/the-ruth-burgundy-maxi-skirt): only Medium is orderable in its feed.
- [Ninety Nine burgundy eyelet skirt](https://shopthe99.boutique/products/burgundy-eyelet-scalloped-maxi-skirt): S, M, and L are available. This alternative uses lace rather than velvet.

Two source photographs are small (284 × 295 and 200 × 159). They are resized to a 400-pixel longest edge for the existing publication contract. They remain the merchant photos, with limited source detail.

## Styling and limits

The frame needs glue, gold paint, and ribbon loops. The pillbox needs glue, red fabric, gold ribbon, and clips. These extra supplies are explicitly excluded from the foam price. Use lightweight foam rather than glass for the frame.

The alien bottle holders need the shopper’s own belt. Fill empty bottles with fabric leaves. No real plants or chemicals are needed. Fortune Teller uses a navy inspiration skirt; shoppable skirts are black. The budget coin accessory is a headband-and-earrings set rather than a hip scarf. Crown and garment alternatives differ in material and cut; notes state these limits.

Merchant inventory can change. No arrival by Halloween is established. The generated costume images are styling references, not merchant photography.

## Validation

All five snapshots pass `validateSnapshot`. Every referenced product photo decodes and satisfies the current publication dimensions. Site runtime checks and publication remain the lead agent’s responsibility.
