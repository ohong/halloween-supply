# Catalog expansion A — five DIY costume builds

Research date: October 26, 2026 (merchant requests retained with UTC timestamps in each snapshot).

These costumes use explicit DIY supplies. A supply is never represented as a finished prop. Each component offers three merchant choices at different prices. The alternate price can reflect a different material, fabric width, or package quantity; those differences are stated in the component and match text. Generated references illustrate an assembled interpretation.

| Costume | Defining construction | Shopper supplies and limits |
| --- | --- | --- |
| Jellyfish Bloom | Tie strips cut from one yard of sheer fabric to a handheld clear umbrella. | Scissors and thread. Trim tentacles above knees. No lights or glow are included. |
| Venus Flytrap | Cut green felt leaves/open collar, add an orange mouth patch, and stitch on white felt teeth. | Scissors, thread, and fasteners. The entire face stays open. This is a soft textile collar, without a rigid jaw frame. |
| Stained Glass Angel | Round and hem one yard of opaque printed cotton into a short wing-shaped cape. | Scissors, thread, and elastic wrist loops. The 36-inch-deep cape is short; it is not transparent and has no wing frame or halo. |
| Lava Lamp | Stitch orange felt blobs to a black base; make a small silver cone cap and wide silver hip band. | Scissors, thread, card backing, elastic, and fasteners. Silver fabric is supplied; a finished hat, base, and lighting are not. |
| Walking Thundercloud | Secure loose white stuffing tufts and short silver fabric rain strips to a handheld clear umbrella. | Scissors and thread or mesh pockets. A 12-ounce bag makes scattered tufts; the 32-ounce option gives more fullness. No lights included. |

## New primary merchant evidence

Merchant product pages were found or checked with built-in web search. Public merchant variant feeds then supplied exact variant price, stock, image, and permalink. Their exact source URLs and checks are retained under `sourcing` in each product. All new Shopify variants reported `available: true` at research time. The 18 new merchant photographs were downloaded, decoded, and cached as WebP. A visual contact-sheet check confirmed the photos depict the selected umbrellas, fabrics, felt, and fiberfill.

- [ShedRain traditional bubble umbrella](https://shedrain.com/products/auto-open-traditional-bubble): clear adult canopy, white-trim variant, $25.
- [ShedRain fashion bubble umbrella](https://shedrain.com/products/bubble-auto-open-umbrella): clear/black-trim variant, $28.
- [ShedRain clear crook umbrella](https://shedrain.com/products/auto-open-bubble-umbrella): clear canopy/handle, $30.
- [Fabric Wholesale Direct crystal organza](https://fabricwholesaledirect.com/products/crystal-organza-59-60-inch-fabric): pink yard, $2.99; plain sheer pink rather than iridescent.
- [Fabric Wholesale Direct iridescent organza](https://fabricwholesaledirect.com/products/iridescent-pearl-organza-fabric): pearl yard, $4.49.
- [Ice Fabrics reflective sheer chiffon](https://icefabrics.com/products/silver-crystal-reflective-liquid-sheer-chiffon-fabric): one silver yard, $9.99.
- [Fabric Wholesale Direct tissue lamé](https://fabricwholesaledirect.com/products/tissue-lame-44-45-inch-fabric): one silver yard, $4.99.
- [Ice Fabrics silver bridal satin](https://icefabrics.com/products/silver-shiny-bridal-satin-fabric): one yard, $5.99.
- [Ice Fabrics silver stretch satin](https://icefabrics.com/products/new-shiny-silver-charmeuse-stretch-satin-fabric): one yard, $7.99.
- [Benzie white wool-blend felt](https://www.benziedesign.com/products/white-wool-blend-felt): 9×12-inch sheet $1.50, 12×18-inch sheet $2.50, half-yard $6. All suffice for small decorative teeth; larger cuts leave excess.
- [Good's Store fiberfill](https://goodsstores.com/products/poly-fil-original-pf): 12-ounce bag $8.49 and 32-ounce bag $19.99. The saved images show the respective bag labels.
- [EconoCrafts fiberfill](https://econocrafts.com/products/premium-polyester-fiber-fill-stuffing-12-oz): 12-ounce bag $9.98.
- [Fields Fabrics rainbow mosaic cotton](https://shop.fieldsfabrics.com/Cotton-Rainbow-Stain-Glass-Stained-Glass-Mosaic-Colorful-Multi-Color-Cotton-Fabric-Print-by-the-Yard-118036_p_92908.html): $11.95 per yard, explicit “In Stock Online”; 44-inch width. Fine mosaic alternative, without the default fabric's large black outlines.
- [Stonemountain stained-glass cotton](https://stonemountainfabric.com/product/bx-16881-99/): $15.20 per yard, structured offer `InStock`, inventory 6.25 yards during check. This is the default cape fabric with black-outlined rainbow shapes.
- [Purpleseamstress tropical stained glass](https://purpleseamstressfabric.com/product/tropical-stained-glass-cotton-lycra/): woven cotton, 140 gsm, 42 inches wide, displayed $21 per yard and in-stock status. Structured offer still says $20; the displayed $21 option price is retained and checkout must recheck. Floral window print differs from the default abstract print.

## Existing reviewed products

Plain black unitards, dark ankle boots, ivory tunics/trousers, cream rope ties, green/orange felt, and lightning pins reuse appropriate offers from Moon Moth, Snow Owl, Enchanted Jester, Pumpkin Harlequin, and Storm Chaser. Their original IDs, facts, pictures, timestamps, source records, and stock state remain unchanged. New costume component IDs are prefixed by the new costume slug.

No product is charged twice within any of these five costumes. No merchant stock was reserved. Arrival by Halloween is unverified. Small consumables and shipping are not included in displayed totals. No database write or deployment occurred in this task.

## Checks run

- All five snapshots passed `validateSnapshot()` with strict in-stock-default validation and distinct price tiers.
- Each snapshot has a different product ID in every component match, avoiding duplicate charges within an outfit.
- All 18 new cached WebP images decoded and were visually inspected in a contact sheet.
