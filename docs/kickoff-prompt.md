# Kickoff: build halloween.supply v1 with an agent team

You're the lead (the General) for building halloween.supply v1 end to end. Read `brief.md` first: it's the spec, and everything below assumes you've read it. Then read `AGENTS.md`, the Next.js docs in `node_modules/next/dist/docs/`, and the AI SDK docs in `node_modules/ai/docs/` once the AI SDK is installed. This repo runs Next.js 16 and AI SDK 7, and both differ from your training data.

**Finish line.** The brief's "Finish line for v1" passes on the production `https://halloween.supply` deploy, using a Stripe test key. A test checkout with card 4242 4242 4242 4242 must succeed, and the resulting Stripe session must carry each piece's merchant, product URL and size in metadata. `bun run build`, `bunx tsc --noEmit` and `bun run lint` must all pass. You verify the full flow yourself in the built-in browser on desktop and mobile widths. Track progress in `TASKS.md` (goal, finish line, milestones with status, next step). Update it after each milestone, and read it first if you resume.

## Existing code to build on

The repo already has a costume gallery: `app/page.tsx`, `components/costume-gallery.tsx`, `components/saved-looks.tsx`, `lib/costumes.ts`, `app/costumes/[slug]/page.tsx`, `app/globals.css`, and cutout images in `public/costumes/`. It lists five costumes.

- **`cosmic-cowboy` is the live costume.** Its `pieces` list in `lib/costumes.ts` seeds the decomposition step. The other four costumes stay on the home page as "coming soon" tiles and never link to a shop page.
- **Keep the gallery's structure, copy and saved looks.** Where `app/globals.css` conflicts with the brief's Design section (background color, card radius, grid gap), the brief wins.
- **The monochrome-to-color hover applies to the existing tiles now.** Generating editorial photos is a later polish step (milestone 5).

## Preflight (do this before any building)

Check every item below and report everything missing in **one** message, then continue with whatever isn't blocked:

- Every variable in `.env.local` has a value. Check names and emptiness only, and never print values. The variables are `ANTHROPIC_API_KEY`, `BRIGHTDATA_API_KEY`, `BRIGHTDATA_SERP_ZONE`, `BRIGHTDATA_UNLOCKER_ZONE`, `FALKORDB_URL` and `STRIPE_SECRET_KEY`. `STRIPE_SECRET_KEY` must start with `sk_test_`.
- `vercel whoami` succeeds and the Vercel CLI is current.
- `stripe projects` status works for the project "halloween-supply" (see `AGENTS.md`).
- `uv` is installed, because the image step runs `rembg` through `uvx`.
- FalkorDB answers a `RETURN 1` query.
- The Bright Data key works: make **one** SERP call with the Google Shopping search type and `brd_json=1`. Record whether the response has a populated `shopping` array with prices. That answer decides how the pipeline's search step parses results.

## Pre-approved decisions (don't ask about these)

- **Dependencies.** These are approved:
  - `ai`, `@ai-sdk/react`, `@ai-sdk/anthropic`, `zod`
  - `falkordb`, `stripe`, `sharp`
  - shadcn/ui components and Vercel AI Elements, installed through their CLIs (`bunx shadcn@latest …`), plus whatever those CLIs pull in
  - `rembg`, run through `uvx --from "rembg[cli,cpu]" rembg` in the pipeline only, never as a runtime dependency

  Anything else: stop and ask.
- **Models.** Use the direct Anthropic provider (`@ai-sdk/anthropic`) with `ANTHROPIC_API_KEY` for all text inference. One constant in `lib/ai/models.ts` holds the Anthropic model ID `claude-sonnet-5-5`. Confirm it remains available in Anthropic's model list. Pass `anthropic(modelId)` to AI SDK calls; do not use gateway model strings.
- **Product images.** They're processed offline and committed to `public/products/`. The flat-lay is composed with `sharp`: a knolled grid of the cutouts on `#EFEEEF`. The daily cron refreshes only price and stock, never images.
- **Cart state.** Client-side React context persisted to `localStorage`, with no state library. Sizes live on cart items.
- **Assistant tools.** The tools that record sizes and add to the cart run client-side through AI SDK client tools. The graph tools run on the server.
- **Checkout re-check.** Fetch every cart product in parallel with a 10s timeout each. If a fetch times out, fall back to the stored price and flag `price_unverified` in metadata. If a product is sold out, block checkout and tell the user which piece to swap. If a price changed, use the new price and show it before redirecting.
- **Cron.** Configure it in `vercel.json` (`crons`) and protect it with a `CRON_SECRET` env var. You may generate that value and add it to `.env.local` and Vercel.
- **Outside-repo actions.** You're authorized to:
  - create or link the Vercel project, set its env vars (production and preview) and deploy to production
  - add the `halloween.supply` domain to the project and set the DNS records Vercel asks for on the Cloudflare zone through Stripe Projects
  - write to FalkorDB
  - spend up to about $20 of Bright Data credit

  Anything beyond that: stop and ask.
- **Git.** Commit to `main` after each reviewed unit of work, with concise messages. Workers never commit; you review their diff and commit. Never stage `CLAUDE.md`, `AGENTS.md`, `TASKS.md` or `.env*`.

## Phase 0: foundation (you, sequentially, before spawning anyone)

This phase exists so the workers can run in parallel without blocking on each other. Keep it small and get the contracts right.

1. **Install and set up the toolchain.** Install the approved dependencies, initialize shadcn, and add AI Elements.
2. **Write the design tokens.** Put the brief's tokens (colors, type scale, radii, spacing, 150ms color-only transitions) into `app/globals.css` and the Tailwind `@theme`, then reconcile the existing gallery styles with them.
3. **Write the shared types in `lib/types.ts`.** They are `Costume`, `Piece`, `Product`, `Merchant`, `Neighborhood`, `Tag`, `PickReason` (the graph path behind "why this pick") and `CostumeSnapshot` (a costume with its pieces, each with a default product and two alternatives, merchants and tags). Also add `CartItem` (product, piece, merchant, size, price in cents).
4. **Write the contract stubs.** These are function signatures with JSDoc and `throw new Error("not implemented")` bodies. Workers fill them in:
   - `lib/graph/client.ts`: a cached connection.
   - `lib/graph/queries.ts`: `getCostume(slug)`, `getAlternatives(pieceId, {localOnly?, maxPrice?})`, `getMerchantCatalog(merchantId, costumeSlug)`, `getFewestShops(productIds)`, `getPickPath(productId, pieceId)`.
   - `lib/graph/upsert.ts`: `upsertSnapshot(snapshot: CostumeSnapshot)`.
   - `lib/brightdata/client.ts`: `serpSearch(query)` and `fetchProductPage(url)`, which return typed results.
   - `lib/products/parse.ts`: `parseProduct(html, url)`, which returns price, title, images, availability and sizes.
5. **Create the fixture.** Write `data/costumes/cosmic-cowboy.json`: a realistic hand-written `CostumeSnapshot` with plausible non-big-box merchants (at least two in the Bay Area, and one merchant carrying two pieces so "fewest shops" has something to show). Use placeholder grey images. The pipeline overwrites this file later in the same shape, so frontend work never waits on scraping.
6. **Commit.**

## Phase 1: parallel build (spawn workers in the background)

Use the `worker` agent for each of these. Each worker owns only the paths listed and treats the Phase 0 contracts as fixed. If a contract has to change, the worker stops and tells you, and you change it and notify the affected workers through SendMessage. Every brief you send states the goal, the owned paths, the contracts, the finish line, the verify command, and the return format (files touched, commands run with results, open questions).

1. **Graph.** Owns `lib/graph/**`, `scripts/seed.ts` and `scripts/warm.ts`.
   - Implement the schema from the brief, `upsertSnapshot`, every query in `queries.ts`, and a vector index only if a query needs one.
   - `scripts/seed.ts` loads a snapshot JSON into FalkorDB idempotently (`bun run seed`).
   - `scripts/warm.ts` pings the graph and re-seeds it when empty, for demo day.
   - **Verify:** seed the fixture, then run each query from a small script and check that the results are correct. `getFewestShops` must return the fixture's shared merchant.
2. **Sourcing pipeline.** Owns `scripts/source/**`, `lib/brightdata/**`, `lib/products/**`, `lib/sourcing/blocklist.ts` and `public/products/**`.
   - Implement the brief's six steps for `cosmic-cowboy`: decompose (structured output), SERP search with the domain blocklist, Unlocker fetch with retries and short timeouts, parse (JSON-LD and Open Graph first, Claude extraction as fallback), rank (Bay Area boost, default plus two alternatives, with reasons), and images (rembg cutout onto `#EFEEEF` with `sharp`, plus the flat-lay).
   - Cache raw responses under `data/cache/` (gitignored) so reruns don't spend credits.
   - The pipeline writes `data/costumes/cosmic-cowboy.json` and calls `upsertSnapshot`. Run it with `bun run source cosmic-cowboy`.
   - **Verify:** a full run produces at least five pieces with three products each and zero blocked domains. Every product has a live URL, a price, and a processed image.
3. **Storefront.** Owns `app/page.tsx`, `app/costumes/**`, `components/store/**`, `components/costume-gallery.tsx` and `lib/cart/**`.
   - Build the home mosaic with "coming soon" tiles.
   - Build the costume page: carousel with the flat-lay first, piece list, swap control with two alternatives, support-local badge, "why this pick" (from `getPickPath`), and add-to-cart plus "add whole costume".
   - Build the cart slide-over with the fewest-shops note and a checkout button that calls `POST /api/checkout`.
   - The costume page is server-rendered from `getCostume`.
   - **Verify:** the built-in browser at 375px and 1440px shows no layout breaks, and the swap, add and remove actions and the cart all work against the seeded fixture.
4. **Shopping assistant.** Owns `app/api/chat/**`, `lib/ai/**` and `components/assistant/**`.
   - Build the AI Elements chat panel on the costume page.
   - Server tools wrap the graph queries: alternatives, local-only, under a price, and what else this shop carries.
   - Client tools: `recordSizes` writes to cart items, and `addToCart` adds a product.
   - Replies render product cards with add-to-cart.
   - The system prompt keeps answers inside the graph's catalog, asks for sizes before checkout, and never invents products or prices.
   - **Verify:** in the browser, these all work end to end: "I'm a medium, size 10 boots", "something cheaper for the hat", "only local shops", and "what else does this shop sell".
5. **Checkout.** Owns `app/api/checkout/**`, `app/api/cron/**`, `app/success/**`, `lib/checkout/**` and `vercel.json`.
   - Build the re-check described above, then the Stripe Checkout session: one `price_data` line item per piece, images, metadata, shipping address collection, `success_url` and `cancel_url`.
   - Build a minimal success page and the cron route that refreshes price and stock in the graph.
   - It imports `fetchProductPage` and `parseProduct` from the pipeline worker's modules. Build against the contract, and test against the real modules once they land.
   - **Verify:** a test-mode session is created and paid with 4242, and its metadata is correct when you inspect it in Stripe.

While they run, you review each diff as it arrives, against the brief and the finish line, not against the worker's summary. Then you commit it and unblock dependents. Use `Explore` with `model: "haiku"` for any codebase searches you need. If a worker fails the same task twice, take it over. If you're stuck after that, consult `deep-reasoner`.

## Phase 2: integrate, polish, ship (you, plus workers as needed)

1. **Real data.** Run the real pipeline and seed FalkorDB with its output. Replace the fixture as the source of truth, but keep the fixture file for offline development.
2. **Full flow, local.** In the built-in browser, run the whole flow locally: home → cowboy → swap a piece → assistant sets sizes → cart → Stripe test checkout → success page.
3. **Fresh-context review.** Have a fresh-context subagent review the full diff since Phase 0 for merge-blocking issues only (each with `file:line` and the input that breaks it). Confirm each finding yourself and fix the real ones.
4. **Ship.** Deploy: Vercel env vars, production deploy, the `halloween.supply` domain with DNS, and the cron registered. Run `bun run warm` against production FalkorDB.
5. **Full flow, production.** Repeat the full flow on `https://halloween.supply` at mobile and desktop widths.
6. **Polish.** If time remains, generate an editorial photo for the cowboy tile through the available image generation tool, keeping the monochrome-to-color hover.

## Final report

Open with **Blocked on you**: anything waiting on Oscar, or "nothing". Then report against the finish line:

- The production URL and the test session ID.
- The pieces and merchants that were sourced, with Bay Area merchants marked.
- What's unfinished or unverified.
- Remaining risks from the brief's Risks section that now need a decision (shipping policy, switching to live Stripe keys, the FalkorDB tier).
