# Precomputed catalog sourcing

The live snapshot contains merchant products, current USD prices, and in-stock variant titles. No product facts are generated. Claude decomposes the costume and ranks checked candidates. Bright Data searches Google Shopping and organic results, then fetches merchant pages through Web Unlocker. When Shopping cards link only to Google, the curated discovery list supplies researched independent-store URLs. Public merchant HTML is the fallback when Unlocker fails. Shopify's public product endpoint confirms exact stock, prices, and the selected color. Products without positive stock evidence are excluded.

Run from the project root:

```sh
bun --env-file=.env.local scripts/source/serp-probe.ts "silver cowboy hat"
bun --env-file=.env.local scripts/source/index.ts cosmic-cowboy --skip-images
bun --env-file=.env.local scripts/source/images-only.ts cosmic-cowboy
```

The first command intentionally makes one Shopping request. The next commands save completed pieces incrementally, write a snapshot, and upsert FalkorDB. The same commands accept `velvet-vampire`, `moon-moth`, `linen-ghost`, and `woodland-mushroom`. Each costume has five purchasable pieces and three checked options per piece. The extra discovery lists and stable piece IDs live in `scripts/source/costumes/`.

`--only=cowboy-hat` refreshes one piece. `--dry-run` skips snapshot and graph writes. Raw responses stay in ignored `data/cache`; merchant facts expire after 15 minutes and search results after one day. Checkout rechecks each selection without this cache.

Image processing uses pinned rembg 2.0.86 through `uvx` with U2Net. It publishes a uniform grey JPEG and a transparent PNG per product. Published cutouts are bounded to 1000×1250 and survive a fresh checkout. The first carousel slide arranges the selected cutouts and changes when a shopper swaps an item; the following slides retain original merchant photography. A separate static five-piece flat-lay supports fallback rendering and asset verification. A costume image changes only after every default cutout exists.

Prefer complete product-only gallery photos. Background removal alone can retain a model or mannequin. Reviewed source choices, masks, and product-preserving edits remove those remnants. Never recolor a product to match the brief or reconstruct a different product. Use `--force --defaults` with the images-only command to regenerate the five default images. Review every regenerated silhouette before publishing it.

Do not upsert a new product image path into a live costume before its assets are deployed. Prepare and verify the snapshot locally, deploy the assets, then seed the updated graph. This avoids broken images during a release.

Local merchant address evidence is recorded in `curated.ts` and came from these official pages:

- [Wilder West product and Pier 39 storefront address](https://wilderwest.com/products/stetson-john-wayne-peacemaker-4x-wool-cowboy-hat).
- [Standard & Strange West Berkeley storefront](https://standardandstrange.com/pages/visit-us).

The static snapshot is a verified fallback for a sleeping FalkorDB free-tier instance. Checkout always rechecks the selected merchant variant without this cache. Availability remains size-specific: for example, the discounted silver Cindy Jane boots currently have only size 5.5 in stock. The assistant must respect the saved size list and suggest a swap when needed.
