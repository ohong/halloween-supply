# Catalog sourcing and publication

All 25 costumes have complete catalogs. Every purchasable component has three
relative price options. Components include garments, confirmed bundles, and
explicit DIY supplies. The full catalog research uses built-in web search and
primary merchant pages or public variant feeds. No Firecrawl was used for that
research. Evidence, selected sizes, lead times, and style compromises are under
`docs/sourcing/price-tiers/`.

```sh
bun scripts/source/import-price-tier-research.ts /path/to/reviewed-research
bun scripts/source/cache-price-tier-images.ts /path/to/reviewed-research
bun --env-file=.env.local scripts/seed.ts --all
```

The importer accepts one reviewed JSON file per editorial costume. New component
metadata supplies its name, category, size kind, order, required flag, queries,
and styling notes. Every component needs three distinct USD prices and at least
one confirmed in-stock choice. Exact-price size variants remain separate. Known
placeholder selectors are excluded. A bundle is one charged component; the same
product cannot be charged under two different components in one costume.

The image step caches actual merchant photographs as WebP and keeps the original
source URLs and image hashes. It never invents substitute products. The generated
costume inspiration remains the first carousel slide. New catalogs explicitly
mark it as a generated reference; all their products need reviewed merchant photos.
Existing product flat-lays and cutouts retain their stricter validation path.

Deploy reviewed assets before seeding the shared database. Publication validates
that local images decode, have visible content and sufficient dimensions, and
match the exact bytes served at `https://halloween.supply`. `CATALOG_PUBLIC_ORIGIN`
can select another deployment for another database. Per-costume database writes
are atomic. Incomplete drafts stay outside the bundled catalog.

```sh
bun --env-file=.env.local scripts/verify-full-catalog.ts https://halloween.supply
bun --env-file=.env.local scripts/catalog-check.ts
bun scripts/verify-publication.ts
```

The full verifier checks every gallery look, rendered component and merchant
link, three price controls, real image hashes, health coverage, bundled fallback,
and Turso parity. It makes no purchase or model request. The publication verifier
also exercises failure paths using temporary files.

The older automatic sourcing workflow remains available for its authored specs:

```sh
bun --env-file=.env.local scripts/source/index.ts cosmic-cowboy --skip-images
bun --env-file=.env.local scripts/source/images-only.ts cosmic-cowboy
```

That workflow uses Firecrawl discovery and raw-page extraction, direct Anthropic
ranking, and public merchant feeds. Its cutout processing uses pinned rembg through
`uvx`. It keeps checkpoints under ignored `data/cache/source-checkpoints`; these
never replace a complete catalog. `--dry-run` skips writes and `--allow-partial`
keeps an incomplete draft without publishing it.

Routine checkout and refresh verify merchant prices, selected sizes, stock and
USD currency again. Refresh retains only sizes at the saved verified price.
Unknown stock and delivery timing remain explicit. Research snapshots support
browsing during database outages; they never establish a live merchant checkout.
