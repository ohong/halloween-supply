# Screenshot sourcing

The screenshot route reads one image, then streams verified merchant products into the flat-lay. It does not publish a new editorial catalog.

## Search and verification

```text
compressed screenshot -> cached image analysis
                              |
                    reviewed merchant URL hints
                              |
               exact product feed / product page
                              |
              no suitable offer? Firecrawl search
                              |
             ranked product URLs + links in excerpts
                              |
                verify garment, color, variant,
                adult audience, stock, USD price
                              |
                    stream product + cart item
```

Two approaches were considered. An additional AI ranking call can compare nuanced visual details, but adds provider latency and cost for every piece. This route uses bounded garment, color, audience, and style checks. They reject known bad substitutions while keeping screenshot sourcing quick. The separately shipped typed costume-creation flow retains its stricter semantic review.

Previously sourced catalog URLs are hints, not stock or price answers. The route reads their current merchant feed or page before returning an offer. Firecrawl handles unknown pieces and failed hints. No mock products or invented prices are used.

Discovery keeps the precise product query first. Generic gender suffixes are removed because observed results often returned collections. A second, broader adult query excludes the dominant blocked/noise domains. The complete merchant blocklist applies to every candidate and redirect, independently of search filtering.

Firecrawl result excerpts sometimes contain exact product links under a collection hit. The route extracts same-merchant links and verifies their product pages directly. It never treats excerpt prices or stock claims as checkout facts.

Candidates are ranked before applying the four-page limit. Up to two products from one host remain eligible. Reads race so a slow merchant cannot delay another acceptable match. Losing reads are cancelled. Shopify feeds and direct currency-page checks have a 3.5-second timeout; cart currency reads have 2.5 seconds. Other merchant pages get a five-second Firecrawl timeout. The screenshot run has a shared 50-second deadline, including queued searches and retries.

Shopify offers carry an explicit USD selection into checkout. The merchant page and cart must agree on currency. A cart claiming USD cannot override a page that still prices the same cents in EUR. Abbreviated child sizes such as `18–24m`, `2–4y`, and `3T` are filtered before selecting the purchasable variant family.

The route rejects incompatible garment types, wrong color variants, explicit child/pet/doll audiences, age-labeled variants, rentals, digital patterns, and unsupported identifying style details. It checks secondary colors in merchant evidence for details such as red lining or white spots. These checks are conservative heuristics, not visual proof of an exact match. Color families include close alternatives, such as ivory/cream/white.

## Caching and limits

- Firecrawl discovery and image analysis expire after 24 hours.
- Merchant pages, Shopify facts, merchant currencies, and complete screenshot looks expire after 15 minutes.
- Partial looks are never cached as finished results. Their image analysis can be reused on retry.
- Complete replays return immediately with an explicit cache message. They do not simulate old searches or delay the response.
- Timeouts are excluded from discovery cache keys; changing a deadline cannot duplicate an otherwise identical search.
- Failed or cancelled Shopify reads are not cached as missing products.
- Vercel caches use `/tmp`; local runs use ignored `data/cache`. `SOURCING_CACHE_DIR` isolates acceptance runs.
- Caches and concurrency guards are per instance. They do not promise a hit after a cold start or deployment-wide quotas.
- Three screenshot searches can run concurrently. A 429 starts a bounded cooldown. Only short explicit `Retry-After` values permit one retry.
- Browser uploads are re-encoded below 3 MB. The route's multipart body limit stays below Vercel's function upload limit.

Checkout independently rechecks merchant prices, stock, and explicit sizes. Stripe remains in test mode. Screenshot results do not order from merchants.

## Reproduce acceptance checks

```sh
bun run build
SOURCING_CACHE_DIR=/tmp/halloween-screenshot-check bun run start --port 3402
# A separate terminal; real OpenAI, Firecrawl, and merchant calls:
bun scripts/verify-screenshot-sourcing.ts http://localhost:3402 --repeat --require-complete
# Also create and inspect five TEST sessions, then expire them unpaid:
bun scripts/verify-screenshot-sourcing.ts http://localhost:3402 --checkout --require-complete
```

Use `SCREENSHOT_SAMPLES` for comma-separated public costume image slugs. Use `SCREENSHOT_EVIDENCE_DIR` to save NDJSON and timing summaries. The default samples are the original five demo costumes. `--require-complete` deliberately fails if an external merchant or provider prevents a complete look; it does not hide partial results.

The benchmark uses the same public reference PNGs before and after the change. Vision output and external search/inventory can vary. These are sample acceptance measurements, not a general quality or latency guarantee. Follow [the manual checklist](./demo-manual-checklist.md) for unseen screenshots, physical camera/voice, phone handoff, sharing, and generated appearance.

## References

- [Firecrawl search and selective scraping](https://docs.firecrawl.dev/features/search)
- [Firecrawl v2 search parameters](https://docs.firecrawl.dev/api-reference/endpoint/search)
