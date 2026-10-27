# Halloween Supply

A curated costume store built from individual pieces at independent merchants.
All 50 costumes have saved shopping catalogs with three distinct price points
for each purchasable component: $, $$, and $$$. Components are separate garments,
confirmed bundles, or clearly described DIY supplies. Every look supports merchant
links, swaps, budget styling, cart selections, and the generated inspiration image.
The homepage shows each look on the same male or female model. Its model toggle
switches all 50 previews and each costume page's first carousel image. The browser
remembers the choice across navigation and refreshes. The 100 transparent images and their generation prompts
are saved in `public/costumes/models/` and `docs/design/model-gallery-image-prompts.json`.

## Search and custom looks

The landing search filters locally while you type. Direct Anthropic inference
then ranks the existing catalog by meaning. The selected model and Saved view
continue to work with filtered results. Search uses bounded requests and falls
back to clearly labelled local matches when semantic refinement is unavailable.

Create starts only after a click. It plans a new costume, checks merchant offers
and their relevance, and saves an unlisted result in Turso. New looks show real
product photos, prices, sizes and missing components. They support the cart and
live checkout checks, but do not join the reviewed three-price-tier catalog.
No generated model image is claimed for custom looks.

See [the implementation spec](docs/semantic-search-and-create.md).

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

The full 50-costume catalog was researched with built-in web search and direct
merchant evidence, with no Firecrawl used for this research pass. Research records
for the original 25 looks are in `docs/sourcing/price-tiers/`. The 25 new looks
have evidence in `docs/sourcing/expansion-{a,b,c,d,e}.{json,md}`. They reuse
appropriate reviewed basics and add newly checked defining pieces. DIY looks
state assembly steps and extra supplies; made-to-order options do not promise
arrival by Halloween.

The budget stylist at `/api/outfits` uses OpenAI Decisions (`gpt-6-luna`) to compare
complete affordable outfits. It receives the costume reference, merchant photos,
product facts, and the shopper's budget, sizes, owned pieces, event date, and notes.
Code enforces constraints before the model chooses a catalog outfit. It never
invents products or prices, spends beyond the pieces budget, or pretends an API
failure is an AI recommendation. Explicitly late production times are excluded;
arrival remains unconfirmed. Chat continues to use Anthropic directly.

The assistant records sizes and updates the guest cart. Stripe collects email and
a US shipping address. The concierge can read merchant, product URL, and size from
each Stripe product's metadata. Fulfillment remains manual.

Required variables: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `FIRECRAWL_API_KEY`, `TURSO_DATABASE_URL`,
`TURSO_AUTH_TOKEN`, `STRIPE_SECRET_KEY`, and `CRON_SECRET`. Keep credentials in
`.env.local` and Vercel environments. Never commit them.

```sh
bun --env-file=.env.local scripts/seed.ts --all
bun --env-file=.env.local scripts/catalog-check.ts
bun --env-file=.env.local scripts/source/index.ts cosmic-cowboy --skip-images
```

Original editorial images are in `public/costumes/`. Their prompts are recorded
in `docs/design/costume-image-prompts.json`. Prompts for the twenty additional costumes
are recorded in `docs/design/new-costume-image-prompts.json`. The next 25 looks
have prompts in `docs/design/expansion-{a,b,c,d,e}-images.json`. Product images come
from the checked merchant listings.

## Checks

### Costume Mirror

Each costume page includes a fullscreen live mirror with voice and typed outfit
commands, piece alternatives, kept/owned pieces, budget controls, undo, and saved
look comparisons. Applying a look updates the existing page selections; it does
not place an order. Photo try-on remains available.

The mirror reuses `OPENAI_API_KEY` for GPT-Live and native Decisions. Set
`DECART_API_KEY` on the server to enable transformed live video. The video session
uses a short-lived, model-restricted token and is capped at three minutes. Missing
credentials show an unavailable state rather than a simulated transformation.
See [the mirror implementation and demo checklist](docs/live-costume-mirror.md).

```sh
bun run lint
bun run typecheck
bun run build
bun run start
# In another terminal, with the production build running:
bun scripts/verify-v1.ts http://localhost:3000 --checkout
bun scripts/verify-chat.ts http://localhost:3000
bun --env-file=.env.local scripts/verify-stylist.ts http://localhost:3000 --costume=midnight-pirate
bun --env-file=.env.local scripts/verify-full-catalog.ts http://localhost:3000
bun scripts/verify-model-gallery.ts http://localhost:3000
bun scripts/verify-costume-search.ts http://localhost:3000 --require-semantic
# Optional: source and save one real custom look, without payment:
# bun scripts/verify-costume-search.ts http://localhost:3000 --require-semantic --create
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
