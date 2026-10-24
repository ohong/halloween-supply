# Precomputed catalog sourcing

The live snapshot contains merchant products, current USD prices, and in-stock variant titles. No product facts are generated. Claude decomposes the costume and ranks checked candidates. Bright Data searches Google Shopping and organic results, then fetches merchant pages through Web Unlocker. When Shopping cards link only to Google, the curated discovery list supplies researched independent-store URLs. Public merchant HTML is the fallback when Unlocker fails. Shopify's public product endpoint confirms exact stock, prices, and the selected color. Products without positive stock evidence are excluded.

Run from the project root:

```sh
bun --env-file=.env.local scripts/source/serp-probe.ts "silver cowboy hat"
bun --env-file=.env.local scripts/source/index.ts cosmic-cowboy --skip-images
bun --env-file=.env.local scripts/source/images-only.ts cosmic-cowboy
```

The first command intentionally makes one Shopping request. The next commands save each completed piece incrementally, write the snapshot, and upsert FalkorDB. `--only=cowboy-hat` refreshes one piece. `--dry-run` skips snapshot and graph writes. Raw responses stay in ignored `data/cache`; merchant facts expire after 15 minutes. Search cache lasts one day. Image processing requires `uvx`; it installs pinned rembg 2.0.86 and explicitly uses the U2Net model. A complete five-piece composition is required before the costume image changes. Reviewed photo plans use real merchant gallery images, exterior silhouette masks for the trousers and scarf, and a boot crop. The jacket remains an authentic shoulder/fringe detail crop because its gallery has no isolated full-jacket image. A clean full-garment knoll remains unfinished. Use `--force --defaults` with the images-only command to regenerate just the selected five images.

Local merchant address evidence is recorded in `curated.ts` and came from these official pages:

- [Wilder West product and Pier 39 storefront address](https://wilderwest.com/products/stetson-john-wayne-peacemaker-4x-wool-cowboy-hat).
- [Standard & Strange West Berkeley storefront](https://standardandstrange.com/pages/visit-us).

The static snapshot is a verified fallback for a sleeping FalkorDB free-tier instance. Checkout always rechecks the selected merchant variant without this cache. Availability remains size-specific: for example, the discounted silver Cindy Jane boots currently have only size 5.5 in stock. The assistant must respect the saved size list and suggest a swap when needed.
