# Screenshot sourcing

The screenshot route analyzes one reference image, then streams real merchant offers into the flat-lay. It does not publish an editorial catalog.

## Image understanding and identity

Screenshot analysis now defaults to **OpenAI `gpt-6.1-sol`**, with high-detail images up to 1600 pixels and structured JSON output. GPT-6.1 Sol also handles identity corroboration, search refinement and product-photo review. `OPENAI_VISION_MODEL` can override the default. The response's `X-Vision-Model` header identifies the effective model without exposing credentials.

The model audits the visible outfit head to toe and returns up to ten independent purchases, exact appearance notes, at most three essential features, flexible details and three distinct retail queries per piece. Visually separate retail layers, such as moth wings and a fur collar, remain separate purchases. Openings, attached trim and printed decorations stay part of the garment instead of becoming invented purchases. It must not invent wigs from natural hair, hidden shoes, or the character's usual accessories. Uploaded UI titles and search logs are ignored when analyzing a reference picture.

A character guess alone cannot become the title. Distinctive outfits receive a Firecrawl identity search. Neutral wardrobe searches and up to three private character hypotheses are compared. Uncertain candidates remain research leads; they cannot become a published title without corroboration. The two strongest non-social sources are read because excerpts often name a film but omit the character. A second OpenAI call checks the picture against the supplied sources and cites a source index internally. It also improves shopping terminology when the sources resolve a vague motif or garment name. Uncorroborated identities use a neutral outfit title. Generic outfits can stay descriptive without an identity lookup. Every upload analyzes the image and checks any identity again, including repeated images.

## Search and acceptance

```text
high-detail reference -> visible pieces + search phrasings
                              |
                    corroborate character / film
                              |
             fresh Firecrawl search + supplemental verified URLs
                              |
                 verify merchant offer and variant
                              |
             compare reference AND product photographs
                              |
                  best supported offer, or missing
```

Two approaches were compared. More search retries plus keyword rules are quick, but cannot distinguish a convincing title from a wrong product. This route combines bounded keyword checks with OpenAI visual comparison of the reference, merchant photographs, descriptions and selected variants. It costs more and takes longer on a cold run. It can reject kits, goggles and wrong garments that previously passed.

The strongest suitable offer wins; a fast merchant response cannot win before visual review. Essential garment type, dominant colors, broad construction and identity-defining motifs must agree. The component plan separates essential features from flexible decoration, so an incidental printed star or buckle color cannot reject an otherwise faithful close match. Non-defining hardware or brand details can differ for a close match. Match notes disclose differences beside each result. Actor stills alone do not prove a finished garment is for sale.

Each piece starts with three distinct searches: a concise product query, a useful synonym and, for distinctive replicas, a corroborated character query. The first pass adds shopping intent with “buy online” without requiring Shopify URL patterns. Each Firecrawl search requests up to twenty results. Sol selects up to six likely product pages from the query results and catalog URL hints, with at most two pages per host; irrelevant keyword matches no longer crowd out the actual item. All six verified offers can enter visual comparison; later valid offers are no longer silently discarded. After two failures, OpenAI can rewrite the remaining query from the rejected search excerpts and reference image, with one final broad retail synonym as a fallback. This permits at most four searches without weakening product acceptance. Failed searches can advance to another phrasing. Same-merchant product links in excerpts are discovery hints only.

Product URLs cover additional retail formats, including department stores. A `/products/` path whose Shopify feed is unavailable falls back to Firecrawl extraction; existing Shopify feeds still require variant and currency verification. The final item noun controls category matching, so a waistcoat chain is not treated as a waistcoat. Merchant copy can omit colors, materials or motifs; variant data and photographs still must pass the color and semantic checks. Fine details raise discovery ranking rather than requiring those words in merchant copy.

Simple DIY adaptations are explicit. For an obvious sheet ghost, the model may source a full-size flat sheet and return the eye-hole cutting step. Match notes label this as DIY. Finished garments cannot be replaced with yarn, kits or sewing instructions.

Previously reviewed URLs are also discovery hints. `data/sourcing/screenshot-hints.json` preserves real merchant URLs found and visually verified during acceptance runs. It stores no price or stock promise, and does not bypass image analysis or offer checks. These seeds and the published catalog’s merchant URLs supplement a fresh Firecrawl shortlist when search wording varies. They cannot bypass the web search, fresh merchant reads or visual review. New, unseen items still use Firecrawl. Only add a URL after live merchant verification and reference/product image review. Merchant feeds/pages establish actual price, USD currency, stock, image and size facts. Shopify variants preserve color, purchase type and size family. A title that omits a color can use its merchant description as evidence; an explicit wrong color variant cannot. The product photograph must still pass visual review. Harnesses with actual size options require size selection.

The hard merchant blocklist applies to every offer and redirect. Child, pet and doll products, rentals, knitting/yarn kits, sewing patterns, digital files and wholesale lots cannot stand in for adult clothing. Glasses and goggles have separate checks. Fine gold/silver eyeglass-frame finishes are compared visually rather than hard-filtered by lighting-dependent metal color; thick dark frames and tinted lenses still fail when the reference requires thin clear eyeglasses. Known public Shopify CDN images are bounded, decoded and inlined for visual review, so provider-side image retrieval does not invalidate an otherwise usable shortlist.

Missing or unverifiable matches stay missing. External stock and search quality still limit completion. An industrial harness can be labeled a close costume substitute; it is not represented as the film prop or as assessed safety equipment.

## Freshness and limits

- The request has a shared 105-second deadline; the Vercel route allows 120 seconds. Browser disconnects cancel the run.
- Three screenshot searches run concurrently. A 429 permits one bounded cooldown/retry under the same deadline.
- Identity research has a 30-second budget. Product visual reviews have 22 seconds each.
- Shopify and direct currency-page reads have 3.5 seconds; cart currency reads have 2.5 seconds. Other product pages get five seconds.
- Screenshot requests do not replay saved image analysis, complete looks, piece matches, search results, merchant pages or currency facts.
- Identical queries and merchant currency reads share work only within the current upload. Each subsequent upload starts fresh.
- OpenAI, merchant feeds, currency reads and known CDN image requests explicitly use `no-store`; Firecrawl requests bypass the application's disk cache.
- Supplemental verified URLs contain no saved price or stock promise and are considered only after a fresh web search succeeds.
- Checkout independently rechecks merchant prices, stock and sizes.
- Concurrency guards are per instance, not account-wide quotas.
- Uploads stay below the deployed multipart limit. No image data or credential values are logged. Stripe remains in test mode.

## Real acceptance checks

```sh
bun run build
bun run start --port 3402
# In another terminal:
bun scripts/verify-screenshot-sourcing.ts http://localhost:3402 --repeat --checkout
# The two user regressions, using cropped reference photos kept outside Git:
bun scripts/verify-screenshot-references.ts http://localhost:3402 /path/cardigan.jpg /path/harness.jpg
```

The reference check requires both correct Ryland Grace / Project Hail Mary titles, a real finished cardigan and a real orange harness offer. It rejects invented wigs, hidden footwear, goggles and yarn kits. It also checks that a sized harness exposes size selection. `SCREENSHOT_EVIDENCE_DIR` saves NDJSON and summaries. The five-costume script checks real offers and can inspect exact Stripe test-session line items, then expire the unpaid sessions. `--require-complete` fails on any missing piece instead of hiding it.

These are sample acceptance checks, not a guarantee for unseen images or merchant inventory. Follow [the manual checklist](./demo-manual-checklist.md) for camera, microphone, live voice, physical phones, cross-device handoff and human visual review.

## References

- [OpenAI GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [OpenAI image inputs and detail](https://developers.openai.com/api/docs/guides/images-vision)
- [Firecrawl search and selective scraping](https://docs.firecrawl.dev/features/search)
