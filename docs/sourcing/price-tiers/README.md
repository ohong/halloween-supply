# Price-tier catalog research

Built-in web search and direct official merchant evidence. No Firecrawl was used for this research pass. Exact checked timestamps, product URLs, photos, sizes, and compromises are preserved in the costume JSON files.

Price tiers are relative within each piece. Listed totals exclude shipping and tax; stock and size coverage can change. Higher prices do not imply better quality.

| Costume | Lowest five-piece subtotal |
|---|---:|
| [Cosmic Cowboy](cosmic-cowboy.json) | $100.95 |
| [Linen Ghost](linen-ghost.json) | $201.49 |
| [Moon Moth](moon-moth.json) | $195.97 |
| [Velvet Vampire](velvet-vampire.json) | $166.34 |
| [Woodland Mushroom](woodland-mushroom.json) | $175.24 |

Owned or skipped optional pieces reduce these subtotals. Some lower-priced choices offer few sizes or a looser visual match. Handmade options may require production time. Unknown selected-variant stock remains labeled unknown, rather than being converted into a claim of finished inventory.

`images.json` records the exact source URL and SHA-256 of every cached merchant photograph. The images preserve the merchant photograph; no substitute products were generated.

Import reviewed research locally, cache its merchant photos, then verify before publishing:

```sh
bun scripts/source/import-price-tier-research.ts /path/to/research
bun scripts/source/cache-price-tier-images.ts /path/to/research
bun --env-file=.env.local scripts/seed.ts --all
```
