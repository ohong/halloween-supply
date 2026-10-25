# Budget stylist

Each of the five live costumes has five pieces. Every piece has three distinct
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

Five pieces with three choices produce at most 243 combinations. Decisions sees
all affordable combinations, the generated costume reference, actual merchant
photographs, factual product notes, and the shopper's constraints. It selects one
supplied outfit ID or declines. Application code resolves that ID back to catalog
products and prices. It never trusts model-generated amounts or product IDs.

The provider supports 255 choices. This endpoint permits at most 254 affordable
outfits plus a decline choice, and fails clearly if the catalog exceeds that limit.
The former 24-outfit heuristic shortlist was removed so it cannot hide a useful mix.

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
keeps those prices separate by restricting each offer's size list. Marketplace
sellers remain separate suppliers, even when they share the same domain.

Unknown stock and unknown sizes remain explicit. A made-to-order listing can be
orderable without finished stock. Clear minimum production or dispatch times can
exclude a product for a near event; missing or ambiguous times never prove arrival.
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
bun --env-file=.env.local scripts/verify-costumes.ts http://localhost:3401
```

For local catalog QA before publication, build and run with `TURSO_DATABASE_URL=''`
and `TURSO_AUTH_TOKEN=''`. The existing bundled-catalog fallback then serves the
new files without changing the live database. Use `--allow-database-down` for the
catalog verifier in this mode. The stylist verifier still calls the real Decisions
API. It makes no purchase and does not change the catalog.
