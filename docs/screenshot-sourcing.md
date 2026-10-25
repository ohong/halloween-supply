# Screenshot sourcing

The screenshot page shows useful shopping matches immediately. A merchant page does not need complete price, stock, size or replica evidence to appear on the board.

## Timing and models

The whole request has a **30-second budget**, including image understanding, searches, merchant reads and product-photo checks. It normally finishes sooner. At the deadline, outstanding work is cancelled, existing matches remain, and unmatched slots finish without a match. The server allows 40 seconds as an outer execution limit; the browser has a 35-second network fallback.

Both screenshot understanding and product-photo checks use **`gpt-6-luna` with reasoning `none`**. `OPENAI_SCREENSHOT_MODEL` can override the screenshot-specific model. The older `OPENAI_VISION_MODEL` setting no longer controls this page. `X-Vision-Model` reports the effective model. Other app models are unchanged.

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

Each piece uses a fresh web and image search. A second retail phrasing is used only when the first has no suitable leads. Search highlights are disabled for concise snippets. Six searches can run concurrently per server instance; queued work shares the deadline. Search failures do not start long rate-limit waits or repeated model-ranking loops.

A lightweight relevance check prefers the garment type and common color. Close alternatives and shop collection pages can appear with a clear shop link. Social/reference sites, clearly unrelated product types, child/pet/doll substitutions, digital patterns and the project's blocked retailers remain excluded. Existing merchant URL hints can supplement a failed discovery, but saved prices, stock and match verdicts are never replayed.

A `candidate` event shows a title, merchant, shop link and optional image immediately. Merchant data adds photos, currency, price, availability and sizes independently. Unknown facts stay unknown. Collection pages say “Browse matches at shop”; they are not represented as individual purchasable products. Non-USD items may appear with their actual currency and an external shop link.

One short Luna call per piece compares available product photos with the reference after the matches are already visible. It accepts useful costume alternatives and describes differences. It does not require exact trim, material, hardware or screen authenticity. Unavailable or slow photo checks keep the discovery on the board. A clearly unsuitable photo receives a caution note instead of silently emptying its slot.

A `piece` event adds an item to the existing size/inspection/cart flow only when merchant facts support a USD price and product image and the photo check selects it. Shopify cart and page currency must agree. Missing prices are never fabricated as zero-dollar offers. Checkout independently rechecks prices, sizes and availability.

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
```

The browser check measures actual first paint and event arrival, requires a visible match before search completion, checks the 30-second ceiling, and captures desktop/mobile results. The broader sourcing check accepts useful discoveries without requiring every merchant to expose complete checkout facts. `--checkout` additionally checks priced items through Stripe test checkout and expires the unpaid session. No payment is made.

Provider latency, search coverage and merchant inventory still affect how many items are found. A 30-second deadline is a bound on work, not a guarantee that every screenshot has a purchasable exact match.

References: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [Firecrawl search sources and highlights](https://docs.firecrawl.dev/features/search).
