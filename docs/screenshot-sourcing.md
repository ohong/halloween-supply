# Screenshot sourcing

The screenshot page shows useful shopping matches immediately. A merchant page does not need complete price, stock, size or replica evidence to appear on the board.

## Timing and models

The whole request has a **30-second budget**, including image understanding, searches, merchant reads and product-photo checks. It normally finishes sooner. At the deadline, outstanding work is cancelled, existing matches remain, and unmatched slots finish without a match. The server allows 40 seconds as an outer execution limit; the browser has a 35-second network fallback.

Screenshot understanding uses **`gpt-6-luna` with low reasoning** to retain defining garment construction. Short product-photo checks use Luna with reasoning `none`. The screenshot flow is pinned to Luna; old screenshot-model environment overrides cannot select another model. `X-Vision-Model` reports the effective model. Other app models are unchanged.

One short, structured image call returns a descriptive outfit title, visible purchases, common retail queries, alternate terms, sizing kinds and any simple DIY step. It does not research character identity before shopping. Natural hair, attached trim, printed decoration and hidden clothing do not become invented purchases.

Two approaches were considered: shorten each existing verification step, or separate discovery from enrichment. Shorter checks still make the board wait for the slowest dependency. Discovery now streams first; merchant facts and photo comparisons refine it afterward.

```text
screenshot -> short Luna shopping list
                     |
              parallel web + image searches
                     |
            stream likely matches immediately
                     |
          add photos, prices and sizes as available
                     |
          Luna photo comparison -> match notes
                     |
           finish by 30s, keeping partial results
```

## Discovery and enrichment

Each piece uses a fresh web and image search. A second retail phrasing is used only when the first has no suitable leads. Search highlights are disabled for concise snippets. Firecrawl requests share a two-job queue per server instance, matching the connected account’s browser capacity; queued work shares the deadline. Search failures do not start long rate-limit waits or repeated model-ranking loops. A rate limit, outage or empty search switches to fresh OpenAI live web search using Luna. Backup search is limited to one web-tool call and 12 seconds, within the same 30-second route budget. Only tool-returned URLs become discovery candidates; model-written prices and stock claims are ignored.

Category aliases cover jerseys, cleats, fedoras, crossbelts and medal groups. Horned headwear can be sold as a headband or Viking helmet; the image check decides whether its shape and horn color fit.

A lightweight relevance check prefers the garment type and common color. Close alternatives and shop collection pages can appear with a clear shop link. Social/reference sites, clearly unrelated product types, child/pet/doll substitutions, digital patterns and the project's blocked retailers remain excluded. Existing merchant URL hints can supplement a failed discovery, but saved prices, stock and match verdicts are never replayed.

A `candidate` event shows a title, merchant, shop link and optional image immediately. Merchant data adds photos, currency, price, availability and sizes independently. Unknown facts stay unknown. Collection pages say “Browse matches at shop”; they are not represented as individual purchasable products. Non-USD items may appear with their actual currency and an external shop link.

One short Luna call per piece compares available product photos with the reference after the matches are already visible. It accepts useful costume alternatives and describes differences. It does not require exact trim, material, hardware or screen authenticity. Unavailable or slow photo checks keep the discovery on the board. A photo that the model explicitly rejects is removed rather than kept as an unrelated costume match. All merchant photos are fetched and decoded separately before review, so one broken remote image cannot invalidate the other offers.

A `piece` event adds an item to the existing size/inspection/cart flow only when merchant facts support a USD price and product image and the photo check selects it. Shopify cart and page currency must agree. Non-Shopify products must explicitly report in-stock before becoming cart items. Public HTML is tried before using a Firecrawl browser job. Missing prices are never fabricated as zero-dollar offers. Checkout independently rechecks prices, sizes and availability.

The UI consumes NDJSON events directly, without waiting for the full response. Logs flush in batches so they do not trail the board. Priced pieces can be inspected or added while other searches continue. Displayed totals include only priced cart items.

## Verification

```sh
bun run typecheck
bun run build
# Against a running local app or production; these use real provider credits:
node scripts/verify-screenshot-speed.mjs http://localhost:3031
bun scripts/verify-screenshot-sourcing.ts http://localhost:3031
# Optional cardigan/harness regression images, kept outside Git:
bun scripts/verify-screenshot-references.ts http://localhost:3031 /path/cardigan.jpg /path/harness.jpg
# Three supplied examples, kept outside Git:
bun scripts/verify-screenshot-examples.ts http://localhost:3031 /path/football.jpg /path/pilot.jpg /path/adventurer.jpg
```

The browser check measures actual first paint and event arrival, requires a visible match before search completion, checks the 30-second ceiling, and captures desktop/mobile results. The broader sourcing check accepts useful discoveries without requiring every merchant to expose complete checkout facts. `--checkout` additionally checks priced items through Stripe test checkout and expires the unpaid session. No payment is made.

Provider latency, search coverage and merchant inventory still affect how many items are found. A 30-second deadline is a bound on work, not a guarantee that every screenshot has a purchasable exact match.

References: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [Firecrawl search sources and highlights](https://docs.firecrawl.dev/features/search).
