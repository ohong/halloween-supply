# Precomputed catalog sourcing

Saved catalogs contain merchant products, checked USD prices, and variant sizes.
Firecrawl `/search` discovers pages; `/scrape` returns raw HTML with JSON-LD intact.
The curated list supplies additional reviewed merchant URLs. Shopify's public
variant endpoint confirms exact sizes, stock, and colors. Claude ranks verified
candidates through the direct Anthropic API. No product facts are invented.

```sh
bun --env-file=.env.local scripts/source/index.ts cosmic-cowboy --skip-images
bun --env-file=.env.local scripts/source/images-only.ts cosmic-cowboy
bun --env-file=.env.local scripts/seed.ts --all
```

All five costume slugs are supported. Each has five pieces and three options per
piece. `--only=cowboy-hat` refreshes one piece; `--dry-run` skips catalog writes.
Completed pieces are saved locally during sourcing. A complete catalog is then
published to Turso in one atomic write.

Raw responses stay in ignored `data/cache`. Merchant pages expire after 15 minutes;
search results expire after one day. Checkout bypasses both the local cache and
Firecrawl's cache (`maxAge: 0`). Public merchant variant feeds remain the first
choice when they provide exact price and stock without scraping.

Image processing uses pinned rembg 2.0.86 through `uvx` with U2Net. It publishes a uniform grey JPEG and a transparent PNG per product. Published cutouts are bounded to 1000×1250 and survive a fresh checkout. The first carousel slide arranges the selected cutouts and changes when a shopper swaps an item; the following slides retain original merchant photography. A separate static five-piece flat-lay supports fallback rendering and asset verification. A costume image changes only after every default cutout exists.

Prefer complete product-only gallery photos. Background removal alone can retain a model or mannequin. Reviewed source choices, masks, and product-preserving edits remove those remnants. Never recolor a product to match the brief or reconstruct a different product. Use `--force --defaults` with the images-only command to regenerate the five default images. Review every regenerated silhouette before publishing it.

Do not upsert a new product image path into a live costume before its assets are deployed. Prepare and verify the snapshot locally, deploy the assets, then seed the updated database. This avoids broken images during a release.

Local merchant address evidence is recorded in `curated.ts` and came from these official pages:

- [Wilder West product and Pier 39 storefront address](https://wilderwest.com/products/stetson-john-wayne-peacemaker-4x-wool-cowboy-hat).
- [Standard & Strange West Berkeley storefront](https://standardandstrange.com/pages/visit-us).

The static snapshot is a verified fallback for a database outage. Checkout always rechecks the selected merchant variant without this cache. Availability remains size-specific: for example, the discounted silver Cindy Jane boots currently have only size 5.5 in stock. The assistant must respect the saved size list and suggest a swap when needed.
