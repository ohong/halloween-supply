# Budget stylist

All 50 costumes have complete shopping catalogs with three to seven purchasable components. Every piece has three distinct
merchant price points, labeled $, $$, and $$$ relative to that piece. A higher
price is not a quality claim. Rank still records the editorial default independently
of price.

The shopper tells the assistant a total pieces budget, exact merchant size labels,
preferences, an optional event date, and styling notes. Owned pieces cost nothing;
optional pieces can be skipped. The assistant asks Decisions to choose a complete
outfit and shows the selected products. Recommendations do not change the cart or
place an order. The shopper can choose or add the recommended pieces explicitly.
Per-piece size labels override general garment sizes, so a shirt can be Medium
while a waistcoat is 42.

## How selection works

`POST /api/outfits` loads the current costume from the shared catalog surface.
The server enumerates complete combinations, removes sold-out products, rejects
known size mismatches and explicitly late production times, and sums integer cents.
Only affordable combinations reach OpenAI Decisions, using `gpt-6-luna`.

Five pieces with three choices produce 243 combinations; seven produce 2,187. Decisions sees
all affordable combinations, the generated costume reference, actual merchant
photographs, factual product notes, and the shopper's constraints. It selects one
supplied outfit ID or declines. Application code resolves that ID back to catalog
products and prices. It never trusts model-generated amounts or product IDs.

The provider supports 255 choices and bounded structured input. Each request holds
at most 254 complete outfits plus a decline choice. Larger catalogs enter exhaustive
groups; each group winner reaches a final comparison. No heuristic drops a feasible
outfit before Decisions sees it. Small catalogs retain one call. At most three
groups run concurrently, with 24 groups and one final call as a hard request limit.
Evidence records unique outfits, groups, calls, finalists, and repeated evaluations.
Provider errors stop the request; partial winners are never returned.

If the budget is too small, the endpoint returns the exact lowest matching subtotal
and shortfall. It does not recommend an over-budget outfit. A provider error is
shown as an error, not a simulated AI result.

## Evidence and limits

Research records retain direct merchant URLs, checked timestamps, available size
labels, style compromises, and lead-time notes. See `docs/sourcing/price-tiers/`.
The merchant photos are local copies under `public/products/price-tiers/`.
They are never replaced by invented product illustrations. A full generated
costume remains the first carousel image; clicks and arrow keys reach the products.

A listed price applies only to the recorded variants and sizes at that price.
For example, a larger tee may cost more than its smaller variants. The importer
and daily refresh keep those prices separate by restricting each offer's size list.
Placeholder selectors such as “Choose Size...” are never treated as stocked sizes. Marketplace
sellers remain separate suppliers, even when they share the same domain.

Unknown stock and unknown sizes remain explicit. A made-to-order listing can be
orderable without finished stock. Clear minimum production or dispatch times can
exclude a product for a near event; missing or ambiguous times never prove arrival.
Confirmed dress-and-hat bundles form one purchasable component, so the cart does
not charge for a second hat. DIY fabric and trim appear as separate components;
the catalog and assistant state the required assembly.

Shipping and tax are outside the pieces budget. Checkout still rechecks merchant
prices, availability, and sizes before an unpaid Stripe session is created.

Chat stays on the direct Anthropic API. Whole-costume budget requests delegate to
the same Decisions stylist; per-piece filters still use catalog queries. Firecrawl
remains available to the automated sourcing pipeline, but this catalog research
used built-in web search and direct merchant evidence only.

## Verification

```sh
bun run lint
bun run typecheck
bun run build
bun run start --port 3401
bun --env-file=.env.local scripts/verify-stylist.ts http://localhost:3401
bun --env-file=.env.local scripts/verify-stylist-chat.ts http://localhost:3401
bun --env-file=.env.local scripts/verify-full-catalog.ts http://localhost:3401
bun --env-file=.env.local scripts/verify-stylist.ts http://localhost:3401 --costume=desert-alchemist --require-piece-count=7
```

For local catalog QA before publication, build and run with `TURSO_DATABASE_URL=''`
and `TURSO_AUTH_TOKEN=''`. The existing bundled-catalog fallback then serves the
new files without changing the live database. Use `--allow-database-down` for the
catalog verifier in this mode. The stylist verifier still calls the real Decisions
API. It makes no purchase and does not change the catalog.
