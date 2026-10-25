# Halloween Supply

A curated costume store built from individual pieces at independent merchants.
Five costumes have saved catalogs with three options for each piece.

## Run

```sh
bun install
bun run dev
```

Open http://localhost:3000. For a production build, run `bun run build`, then `bun run start`.

## Catalog and checkout

`brief.md` defines the product requirements. Firecrawl discovers product pages and
fetches their raw HTML. The pipeline checks merchant facts, ranks products through
the direct Anthropic API, and saves each complete costume to Turso.

The database uses one validated JSON catalog per costume. This keeps publication
atomic and reuses the same queries for live data and the bundled fallback.
`lib/catalog.ts` is the shared data access surface for pages, assistant tools, and
checkout. Checkout always rechecks the merchant's current price, stock, and size.
Customers approve price changes before continuing.

The assistant records sizes and updates the guest cart. Stripe collects email and
a US shipping address. The concierge can read merchant, product URL, and size from
each Stripe product's metadata. Fulfillment remains manual.

Required variables: `ANTHROPIC_API_KEY`, `FIRECRAWL_API_KEY`, `TURSO_DATABASE_URL`,
`TURSO_AUTH_TOKEN`, `STRIPE_SECRET_KEY`, and `CRON_SECRET`. Keep credentials in
`.env.local` and Vercel environments. Never commit them.

```sh
bun --env-file=.env.local scripts/seed.ts --all
bun --env-file=.env.local scripts/catalog-check.ts
bun --env-file=.env.local scripts/source/index.ts cosmic-cowboy --skip-images
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

Verification calls the real app, Turso, Anthropic, merchant pages, and Stripe.
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
Bearer token. The refresh updates database prices, sizes, and stock, then invalidates
the cached costume page. `/api/health` reports configuration booleans and database
status without exposing credentials.

## Limits

Merchant shipping costs are excluded from the total. The concierge absorbs them.
Orders from several merchants have no guaranteed arrival date. A checkout session
does not reserve merchant inventory. Confirm merchant stock again during manual
fulfillment, and refund unavailable items.

If the Stripe key is a test key, Checkout takes test payments only. A successful
unpaid-session check does not prove a completed payment or a fulfilled order.
