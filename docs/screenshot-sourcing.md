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

## OpenCV vision mode (default)

`SCREENSHOT_VISION=opencv` (the default) splits the work between the OpenCV vision service (`plans/contract.md` v1.1, set by `VISION_SERVICE_URL` and `VISION_SERVICE_TOKEN`) and Luna. `/v1/analyze` segments the person into pieces with colors, garment guesses, a CLIP embedding, a crop and an outline. One Luna call (`labelSegments`) then sees the full screenshot plus every crop and its hints, and decides what each piece is: its name, garment phrase, search query, alternate query and slot, or drops it (skin, hair, duplicates). OpenCV keeps the measurements; Luna's garment phrase replaces OpenCV's top guess, so `/v1/match` and retries use it. `/v1/match` scores each candidate's product photo against its piece. If the service is missing or unhealthy, the upload fails with a 503 before streaming, and a failed Luna label call fails the request; neither falls back to the other. `SCREENSHOT_VISION=luna` keeps the old path above. `X-Vision-Model` reports `opencv-5:<build>+gpt-6-luna`.

The `look` event carries `segmentation` (image size, person outline, service timings) and each piece's outline, so `/screenshot` draws the segmentation over the preview, shows each piece's crop, colors and query, and lists the pipeline timings. Older service builds without outlines render no overlay.

amazon.com (and its subdomains) is an allowed merchant for search and checkout; short links (`amzn.to`, `a.co`) and other Amazon country domains stay blocked.

Each piece runs a small agent loop inside the same 30-second budget. Each retry changes one thing about the query, so the trace shows why the next search differs:

```text
analyze -> piece -> search -> /v1/match -> decide
                      ^                      |
                      |  retry (max 2)       | match       -> accept
                      +----------------------+ weak/reject -> retry or ask
retry query:  color_mismatch -> "<detected color> <phrase>"
              type_mismatch  -> "<color> <next garment phrase>"
              no_garment / no candidates / weak score -> alternate phrase
ask shopper:  retries_exhausted, budget_low (<10 s left), no_new_query
```

An uncertain best result becomes an `approval` event, and the shopper confirms it before it joins the cart. Every step streams as a `trace` event (`perceive`, `label`, `search`, `score`, `decide`, `approve`) and is logged once per request as `screenshot_agent_trace`. The UI shows the trace for each piece.

Verify against a running app with the service configured. This calls the real route, the real service and real search:

```sh
bun scripts/verify-screenshot-agent.ts http://localhost:3000
# Samples can be slugs from public/costumes or PNG paths; --require-retry needs one improving color/type retry:
SCREENSHOT_SAMPLES=eval/traces/moon-moth-upper.png,eval/traces/cosmic-cowboy-upper.png bun scripts/verify-screenshot-agent.ts http://localhost:3000 --require-retry
```

Each run saves its trace to `eval/traces/`. Examples saved there:

- `moon-moth-upper-…22-54`: a color retry ("charcoal satin pantaloons" -> "black satin pantaloons") clears `color_mismatch` and raises the best score from 0.358 to 0.366. That is still a reject, so the piece goes to approval.
- `moon-moth-upper-…26-52`: the same color retry raises the pantaloons from 0.342 to 0.375, and a color retry on the cape ("beige" -> "sage") is followed by a `no_candidates` retry that reaches 0.363. Both stay rejects and go to approval.
- `cosmic-cowboy-upper-…30-18` (stock service image): a color retry on the hat ("silver felt cowboy hat") turns a weak pick at 0.593 with `color_mismatch` into a match at 0.658, which the agent accepts.
- `cosmic-cowboy-upper-…22-12`: a color retry raises the best pantaloons score from 0.269 to 0.364, also still a reject.
- `moon-moth-…`, `storm-chaser-…`: weak results that go to shopper approval.

Known limits, measured against the service running locally:

- Search, not vision, uses most of the budget. Firecrawl's two-job scrape queue makes a first search take 5–19 s, so a retry that starts after about 15 s is rarely scored in time. Looks with five or more pieces (`candy-corn-sorceress-…`) can reach the deadline before every piece is scored.
- `/v1/match` took 1–8 s per piece here, and up to 27 s when several requests ran at once.
- Most retries raise scores without changing the verdict, so those pieces still go to approval. A retry can also return no candidates at all (`moon-moth-upper-…24-35` found nothing).

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
