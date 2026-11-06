# Five additional party costumes

This batch adds five distinct silhouettes and styling ideas. It uses built-in web search and direct merchant public feeds. No Firecrawl calls were made.

New defining pieces come from Chicago Costume Company and Coquetry Clothing. Reused base garments retain their original product IDs, source evidence, cached photographs, and check dates. The structured evidence is in `expansion-c.json`.

| Costume | Pieces | Product options | Default subtotal |
| --- | ---: | ---: | ---: |
| Roller Disco | 3 | 9 | $95.57 |
| Pop Art Comic | 3 | 9 | $304.99 |
| Mad Tea Hatter | 5 | 15 | $540.90 |
| Queen of Hearts | 3 | 9 | $349.98 |
| Candy Automaton | 3 | 9 | $321.88 |

Subtotals exclude tax, shipping, owned items, and DIY supplies. Every charged component has three distinct prices. Each costume has no repeated product across components.

## Styling and timing limits

- Roller Disco uses your own comfortable shoes. Skates are optional and are not sold in the look. The headwear alternatives include two sweatband sets and one pom-pom headband. Legwear alternatives include solid socks, crochet knee highs, and tattered leggings.
- Pop Art Comic requires makeup application. Its speech bubble uses your own cardboard and a fastener. The face-paint palettes contain the colors for dots and contours; brushes and setting products are separate. Follow the label instructions for use around eyes and lips.
- Mad Tea Hatter uses a DIY 10/6 card and optional ribbon in a real top hat. The themed Safari hat alternative has a different pattern and shape. The teacup is an owned styling accessory.
- Queen of Hearts dress options vary substantially in length, color details, headpiece contents, and available sizes. The premium costume is adult Small only. The lowest-price dress is available only in 18w-20w and does not include a crown. Wig photographs show styling examples; wigs do not include clothing or crowns.
- Candy Automaton uses a homemade wind-up key made from owned light cardboard, kitchen foil, and a soft belt. No purchased romper includes a key or working mechanism. The black-velvet alternative changes the red bodice to black.
- Coquetry rompers are made to order. The merchant says they ship within five days of purchase. Arrival before Halloween is not established. Stock is not reserved.

## Verification

- All five snapshots passed `validateSnapshot`.
- All 17 components have exactly three distinct USD prices and an in-stock default in the retained merchant evidence.
- All 51 product records point to existing local merchant-image files. Each image decodes and has a longest dimension of at least 400 pixels.
- Twenty-two new product photographs were downloaded from the merchant source URLs and normalized to WebP. Selected variant photographs take precedence over generic product images.
- A contact sheet was visually checked. The six-color Aquacolor variant photograph was separately checked for white, red, blue, yellow, green, and black colors.
- No database write, deployment, checkout, purchase, or provider image-generation call was performed by this sourcing task. Runtime page and release checks belong to the parent integration task.

No Next.js runtime or documentation issue occurred during this data-only task; there are no feedback candidates.
