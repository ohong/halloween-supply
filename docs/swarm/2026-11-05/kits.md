# Completion kits and event readiness

The kit layer makes ten existing looks practical to complete with owned basics. It does not replace editorial picks or merchant alternatives.

Two approaches were considered. Recomputing the cheapest products on every read reduces curation, but can silently change a kit's defining pieces. Explicit researched product IDs preserve the reviewed composition and make retired references detectable. The implementation uses explicit IDs and calculates every price from the supplied catalog records.

`lib/kits` contains pure helpers that work on the server and in the browser. It imports no database, filesystem, network, environment, or server-only modules.

```text
research definitions + supplied catalog snapshots
                    |
           validate and resolve
                    |
          kit view and card summary
                    |
       selected / owned / skipped
                    |
        purchased products only
```

`getKit(slug, snapshots, { eventDate })` accepts a kit slug or its costume slug. `listKits` returns compact card summaries. `summarizeCostumes` returns minimum required-piece, minimum all-piece, and existing default subtotals for all supplied catalogs.

Every costume piece occurs exactly once in a kit. Required pieces can be owned; only optional pieces can be skipped. Purchased IDs must already match that piece in the catalog. Quantities are exactly one because the cart stores one product per piece. Owned and skipped choices contain no product IDs.

All subtotals use integer USD cents from the catalog. Completion subtotals exclude owned pieces. Extra supplies remain explicit and unpriced. Merchandise prices exclude shipping and tax. Stock and check dates retain their catalog meaning; bundled records do not establish current merchant inventory or a shopper's size.

Event dates use `YYYY-MM-DD`, for any event or year. Published absolute earliest-arrival evidence can exclude a product from a selected event. Processing time, a shipping-policy link, or a pickup option cannot prove arrival. Unknown delivery remains visible. `kitSelections` rejects known-too-late or out-of-stock kits before they can enter the cart. Pickup status means an option exists for the identified products; `pickupItemCount` never implies that the entire kit is available for pickup.

Invalid or retired product references make a kit unavailable without breaking unrelated catalog cards. `validateKit` reports each reason, and the release verifier fails if any published kit cannot resolve. No catalog records or production database entries are changed.

Run `bun scripts/verify-kits.ts` to validate the ten definitions against all fifty bundled catalogs. It independently checks piece coverage, merchant references, price math, owned-cost exclusion, stock flags, and card/detail agreement. This read-only check does not request merchant pages or paid models.

Research evidence, exact verification results, and remaining limits are recorded after integration.
