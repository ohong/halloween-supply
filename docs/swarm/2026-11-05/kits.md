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

Every costume piece occurs exactly once in a kit. Required pieces can be owned; only optional pieces can be skipped. Purchased IDs must already match that piece in the catalog. Quantities are exactly one because the cart stores one product per piece. Owned and skipped choices contain no product IDs. `ownedExtras` states owned basics outside the catalog, such as a romper's underlayer. These do not create catalog pieces or chargeable rows.

All subtotals use integer USD cents from the catalog. Completion subtotals exclude owned pieces. Extra supplies remain explicit and unpriced. Merchandise prices exclude shipping and tax. Stock and check dates retain their catalog meaning; bundled records do not establish current merchant inventory or a shopper's size.

Event dates use `YYYY-MM-DD`, for any event or year. Published absolute earliest-arrival evidence can exclude a product from a selected event. Processing time, a shipping-policy link, or a pickup option cannot prove arrival. Unknown delivery remains visible. `kitSelections` rejects known-too-late or out-of-stock kits before they can enter the cart. Pickup status means an option exists for the identified products; `pickupItemCount` never implies that the entire kit is available for pickup.

Invalid or retired product references make a kit unavailable without breaking unrelated catalog cards. `validateKit` reports each reason, and the release verifier fails if any published kit cannot resolve. No catalog records or production database entries are changed.

Run `bun scripts/verify-kits.ts` to validate the ten definitions against all fifty bundled catalogs. It independently checks piece coverage, merchant references, price math, owned-cost exclusion, stock flags, and card/detail agreement. This read-only check does not request merchant pages or paid models.

All ten definitions resolve against the fifty bundled catalogs. The following new-piece subtotals use those records, before the excluded costs above.

| Kit | New pieces | Assembly estimate |
| --- | ---: | ---: |
| Cosmic Cowboy | $79.97 | 15 minutes |
| Velvet Vampire | $98.39 | 15 minutes |
| Linen Ghost | $64.99 | 30 minutes |
| Starlight Witch | $95.98 | 10 minutes |
| Autumn Scarecrow | $24.99 | 60 minutes |
| Midnight Pirate | $29.00 | 10 minutes |
| Roller Disco | $95.57 | 10 minutes |
| Queen of Hearts | $59.98 | 15 minutes |
| Walking Thundercloud | $47.43 | 120 minutes |
| Venus Flytrap | $13.50 | 120 minutes |

Verification passed on November 6, 2026:

- `bun scripts/verify-kits.ts`: 61 catalog and kit checks, all ten kits, all fifty catalogs.
- `bun scripts/verify-kits.ts 2026-12-31`: the same 61 checks passed for a different event date. The default run uses October 31, 2027.
- Focused TypeScript checking of `lib/kits/index.ts` and `scripts/verify-kits.ts` passed.
- Focused ESLint checking of `lib/kits`, `data/kits/index.ts`, and the verifier passed without warnings.
- A browser-target Bun build passed: six modules, 66.83 KB uncompressed. The library requires no server runtime.
- `git diff --check` passed.

All ten purchase subtotals meet the $100 target. Ownership remains an explicit shopper condition. Supplies and tools can increase the total. Assembly estimates are editorial; no physical build was timed. Queen of Hearts confirms only dress size 18w–20w. Pickup evidence covers one of two Scarecrow purchases, two of three Roller purchases, and both Queen purchases. Location-specific inventory and pickup completion remain unverified.

Every purchased product has a dated primary-source evidence entry. None establishes an absolute earliest arrival date, so delivery remains unconfirmed for all ten kits. The known-too-late exclusion supports such evidence without inventing dates. Current records therefore exercise event-date preservation and unconfirmed delivery, rather than a sourced late-product case.

`unknownStockCount` reports the supplied catalog's unknown flags. Research timestamps do not update catalog stock timestamps. In particular, exact variant refreshes for the cloud and plant kits were rate limited. Their price and stock remain the earlier catalog facts; the newer research notes state this limit. This branch does not claim fresh merchant inventory, browser shopping validation, a production build, or deployment. No qualifying Next.js feedback candidate arose in this work.
