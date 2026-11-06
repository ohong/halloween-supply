# Price-tier catalog research

This directory covers the original 25 researched shopping catalogs. The expanded catalog has 50 looks; evidence for the additions is in `../expansion-{a,b,c,d,e}.{json,md}`. Built-in web search and direct official merchant evidence supplied the options. No Firecrawl was used for this research. Exact checked timestamps, URLs, selected sizes, original photos, lead times, and compromises are preserved in each costume JSON.

Each purchasable component has three ascending USD price points. Bundles count once; DIY supplies have their own component and assembly notes. Higher prices do not imply better quality.

| Costume | Purchasable components | Lowest pieces subtotal |
|---|---:|---:|
| [Velvet Vampire](velvet-vampire.json) | 5 | $166.34 |
| [Cosmic Cowboy](cosmic-cowboy.json) | 5 | $100.95 |
| [Moon Moth](moon-moth.json) | 5 | $195.97 |
| [Linen Ghost](linen-ghost.json) | 5 | $201.49 |
| [Woodland Mushroom](woodland-mushroom.json) | 5 | $175.24 |
| [Starlight Witch](starlight-witch.json) | 5 | $223.95 |
| [Clockwork Aviator](clockwork-aviator.json) | 6 | $276.29 |
| [Autumn Scarecrow](autumn-scarecrow.json) | 6 | $176.40 |
| [Midnight Pirate](midnight-pirate.json) | 6 | $216.75 |
| [Enchanted Jester](enchanted-jester.json) | 6 | $211.29 |
| [Forest Sprite](forest-sprite.json) | 5 | $167.93 |
| [Celestial Sorcerer](celestial-sorcerer.json) | 4 | $237.94 |
| [Pumpkin Harlequin](pumpkin-harlequin.json) | 6 | $158.76 |
| [Victorian Detective](victorian-detective.json) | 6 | $468.83 |
| [Storm Chaser](storm-chaser.json) | 5 | $235.95 |
| [Disco Phantom](disco-phantom.json) | 5 | $243.93 |
| [Garden Beekeeper](garden-beekeeper.json) | 5 | $235.54 |
| [Coral Mermaid](coral-mermaid.json) | 5 | $140.78 |
| [Snow Owl](snow-owl.json) | 6 | $203.30 |
| [Velvet Ringmaster](velvet-ringmaster.json) | 5 | $194.42 |
| [Desert Alchemist](desert-alchemist.json) | 7 | $358.13 |
| [Rose Garden Queen](rose-garden-queen.json) | 6 | $307.59 |
| [Retro Astronaut](retro-astronaut.json) | 6 | $141.88 |
| [Raven Scholar](raven-scholar.json) | 6 | $325.25 |
| [Candy Corn Sorceress](candy-corn-sorceress.json) | 4 | $131.91 |

These exact research subtotals exclude shipping and tax and do not confirm fit or delivery. Owned or skipped optional pieces reduce them. Stock and size coverage can change. Made-to-order items can accept orders without finished stock; uncertainty remains explicit.

Merchant photos are cached without inventing replacement products. images.json records their original URLs and reviewed SHA-256 hashes. The generated complete costume remains a styling reference, not proof of an exact retail garment.

Prepare reviewed research, cache its photos, deploy the assets, and only then seed the shared database:

```sh
bun scripts/source/import-price-tier-research.ts /path/to/research
bun scripts/source/cache-price-tier-images.ts /path/to/research
bun --env-file=.env.local scripts/seed.ts --all
bun --env-file=.env.local scripts/verify-full-catalog.ts https://halloween.supply
```
