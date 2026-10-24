# Halloween Supply

A curated costume store built from individual pieces at independent merchants.
The cowboy is the first live costume. Other concepts are marked coming soon.

## Run

```sh
bun install
bun run dev
```

Open http://localhost:3000. For a production build, run `bun run build`, then `bun run start`.

## Catalog and checkout

`brief.md` defines the v1 requirements. The sourcing script searches with Bright
Data, checks merchant pages, ranks products with Anthropic, normalizes images,
and writes a catalog snapshot plus FalkorDB nodes and relationships.

Pages and assistant tools read the graph through `lib/catalog.ts`. The committed
snapshot keeps browsing available if the free-tier graph sleeps. Checkout always
checks the selected product's current price, stock, and size before creating a
Stripe Checkout session. Customers approve changed prices before continuing.

The assistant records sizes and updates the guest cart. Stripe collects email and
a US shipping address. The concierge can read merchant, product URL, and size from
each Stripe product's metadata. Fulfillment remains manual.

Required environment variable names: `ANTHROPIC_API_KEY`, `BRIGHTDATA_API_KEY`,
`BRIGHTDATA_SERP_ZONE`, `BRIGHTDATA_UNLOCKER_ZONE`, `FALKORDB_URL`,
`STRIPE_SECRET_KEY`, and `CRON_SECRET`. Store credentials in `.env.local` locally
and in the production environment on Vercel. Never commit them.

```sh
bun scripts/source/serp-probe.ts
bun run source cosmic-cowboy
bun run seed
bun run warm
bun scripts/graph-check.ts
```

Original editorial images are in `public/costumes/`. Their prompts are recorded
in `docs/design/costume-image-prompts.json`. Product images come from the checked
merchant listings.

## Checks

```sh
bun run lint
bun run typecheck
bun run build
bun run start
# In another terminal, with the production build running:
bun scripts/verify-v1.ts http://localhost:3000 --checkout
bun scripts/verify-chat.ts http://localhost:3000
```

Verification calls the real app, graph, Anthropic, merchant pages, and Stripe.
The checkout check creates and expires an unpaid session. It does not make a
payment. It requires `STRIPE_SECRET_KEY` for the same account as the running app.
There are no product or provider mocks in these checks.

## Deployment

The private GitHub repository is `ohong/halloween-supply`.
Vercel project `halloween-supply` in the Pacific Systems team uses the GitHub integration.
Each push to `main` creates a production deployment automatically.
Other branches create preview deployments using Vercel's project defaults.

Production URL: https://halloween.supply

Local environment files, Stripe state, and generated agent integrations are excluded from Git.

Vercel runs `/api/cron/refresh` daily at 10:00 UTC. It requires the `CRON_SECRET`
Bearer token. The refresh updates graph prices, sizes, and stock, then invalidates
the cached costume page. `/api/health` reports configuration booleans and graph
status without exposing credentials.

## Limits

Merchant shipping costs are excluded from the total. The concierge absorbs them.
Orders from several merchants have no guaranteed arrival date. A checkout session
does not reserve merchant inventory. Confirm merchant stock again during manual
fulfillment, and refund unavailable items.

If the Stripe key is a test key, Checkout takes test payments only. A successful
unpaid-session check does not prove a completed payment or a fulfilled order.
