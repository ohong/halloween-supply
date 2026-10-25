# halloween.supply — project brief

halloween.supply is a curated store for Halloween costumes built from individual pieces. Instead of a bagged, ready-to-wear costume, you get a cowboy hat from a Bay Area western-wear shop, a vintage pearl-snap shirt from a thrift store, and boots from a niche bootmaker. Then you check out once. The site picks each piece and sources it, and a concierge places the orders.

Product polish and user experience come first. We're building this for the Patch the Conference hackathon, but that's secondary to shipping something people would actually want to use.

## Finish line for v1

Done means that on the deployed `halloween.supply` site, a visitor can:

1. Open the home page.
2. Click the cowboy costume.
3. See its pieces, each with a default pick sourced from a non-big-box merchant.
4. Swap any piece for one of two alternatives.
5. Tell the shopping assistant their sizes.
6. Pay the sum of merchant prices through Stripe Checkout.

The page loads instantly from precomputed data in Turso, and the order shows up in our Stripe account with enough detail (merchant, product URL, size, shipping address) for a human to place it.

## Decisions

**Catalog.** Costumes are curated, never generated from what users type. V1 ships one costume, the cowboy. More costumes come after the full flow works, and costumes users design themselves are a much later idea.

**Sourcing rules.** National big-box retailers are hard-blocked: Amazon, Spirit Halloween, Party City, Halloween City, Walmart, Target, Temu, Shein and similar. These are allowed:

- Etsy shops.
- Secondhand, vintage and pawn shops. Pulling live inventory from Bay Area vintage stores through Firecrawl is ideal.
- Niche DTC brands.

Being in the Bay Area isn't a filter. It gives a merchant a ranking boost and a visible **support-local badge**.

**Curation.** Each piece gets one default pick and a **swap** control showing two alternatives. The default cart is complete in one click.

**Business model.** This is a concierge service. Customers pay our Stripe account, and a human (later an agent) buys each piece from its merchant. For v1 the checkout total is just the sum of merchant prices: no concierge fee, no markup and no shipping line. What happens after checkout (order tracking, emails, fulfillment tooling) is out of scope.

**Sizes.** The shopping assistant asks for sizes in conversation and attaches them to the cart. There are no size pickers on product cards in v1.

**Accounts.** Guest checkout only. Stripe Checkout collects email and shipping address.

## Experience

**Home.** An editorial mosaic of costume tiles. Each tile is an AI-generated editorial photo shown in monochrome that fades to color on hover. Only the cowboy is live, and the other tiles say "coming soon."

**Costume page.**

- **Product carousel.** It opens with a knolled flat-lay of every piece on a uniform grey background, followed by each product photo. All product images have their backgrounds removed and sit on the same grey, so mismatched merchant photography doesn't break the monochrome look.
- **Piece list.** For each piece: the default product, its merchant, the merchant price, the support-local badge where it applies, a "why this pick" explanation, a swap control, and add-to-cart.
- **Shopping assistant.** A simple chat panel on the page. It asks for sizes, answers questions about the pieces ("is the hat real felt?"), and swaps pieces on request ("something cheaper", "only local shops"). Its replies can include product cards that the user adds to the cart directly.

**Cart and checkout.** A slide-over cart lists each piece with its merchant and size. A "fewest shops" note appears when several pieces come from the same merchant. Checkout goes to a hosted Stripe Checkout page with one line item per piece at the merchant's price, then a minimal success page.

## Catalog storage

Turso stores each complete costume as one validated JSON document. It includes
pieces, products, merchants, neighborhoods, tags, and the reason for each match.
A single SQL upsert publishes a complete catalog. Price refreshes patch verified
product fields atomically without replacing unrelated catalog data.

The assistant uses saved catalog queries for alternatives, merchant selections,
pick explanations, and fewer-shop suggestions. The same query functions support
bundled fallback catalogs when the database is unavailable. No graph service is
required.

## Sourcing pipeline (precomputed)

A script runs the pipeline ahead of time and writes the results into Turso. A daily cron refreshes prices and stock. The site never calls Firecrawl while a page loads.

1. **Decompose.** Claude Sonnet 5.5 with structured output turns "cowboy" into pieces. Each piece has a name, a category, a required/optional flag, style notes, and 2–3 search queries.
2. **Search.** Firecrawl finds product-page URLs for each piece. Blocked domains and non-product pages are filtered before fetching.
3. **Fetch.** Firecrawl returns raw merchant HTML. JSON-LD and Open Graph provide product facts; exact Shopify variant feeds confirm sizes and stock. Claude extraction is a fallback for incomplete structured markup.
4. **Rank.** Claude scores the candidates for fit with the costume, uniqueness and quality, with a boost for Bay Area merchants. It picks the default plus two alternatives and writes a short reason for each.
5. **Normalize images.** Background removal puts each product onto the shared grey tile. We also compose the flat-lay.
6. **Write.** The pipeline upserts the costume, pieces, products, merchants, neighborhoods and tags into Turso.

At checkout we re-fetch each product page once to confirm price and stock before creating the Stripe session, because we're charging real money.

## Stack

- **App.** Next.js 16 (App Router) with React 19, TypeScript and bun, deployed on Vercel on the Node runtime. This Next.js version has breaking changes, so read `node_modules/next/dist/docs/` before writing code.
- **AI.** AI SDK with the direct Anthropic provider (`@ai-sdk/anthropic`), authenticated with `ANTHROPIC_API_KEY`, using Claude Sonnet 5.5 (`claude-sonnet-5-5`) for decomposition, ranking, extraction and the assistant. The model ID lives in one place so we can swap it.
- **Chat UI.** Vercel AI Elements for the assistant panel, product-card responses and tool-call display.
- **Components.** shadcn/ui on Tailwind 4.
- **Database.** Turso Starter through Vercel Marketplace, accessed with `@libsql/client/web` over HTTP.
- **Web data.** Firecrawl search and raw page scraping over its v2 REST API.
- **Payments.** Stripe Checkout (hosted) with ad-hoc `price_data` line items and product images. The merchant, product URL and size go in line-item metadata. Shipping address collection is on.
- **Domain.** `halloween.supply`, registered through Stripe Projects/Cloudflare.

## Design

The references are curated.supply, goods.so, Colossus, Hypebeast and Minimalissimo: minimalist, monochrome and functional, with the costumes as the focus. We borrow layout tokens from Paper's design system only as a reference, because it publishes no license and its Favorit typeface is commercial.

- **Type.** Geist and Geist Mono. Geist is a neo-grotesk close to Favorit and is already set up in `app/layout.tsx`. We use light (300) and regular (400) weights with slight positive tracking.
- **Color.** `#FFF` background, `#333` text, `#111` buttons, `#666`/`#999` secondary text, `#CCC` dividers, `#EFEEEF` for sections and the product grey. Costume imagery is the only color, and only on hover.
- **Grid.** A 1px-gap mosaic of 4:5 tiles, with 20px page padding on mobile and 40px on desktop.
- **Shape.** Square corners on images, 4px on buttons and inputs, pill-shaped tags. No shadows.
- **Motion.** Color and opacity transitions only, at about 150ms ease, plus the monochrome-to-color fade on hover.

## Core pieces to build

1. **Database and seed.** Turso catalog storage, validation, and an idempotent seed script.
2. **Sourcing pipeline.** The decompose → search → fetch → rank → normalize → write script for the cowboy.
3. **Storefront.** The home mosaic, the costume page (carousel, piece list, swap, badges, "why this pick"), and the cart with the fewest-shops note.
4. **Shopping assistant.** An AI Elements chat backed by AI SDK tools: catalog queries for alternatives and merchants, a tool that records sizes, and a tool that adds products to the cart.
5. **Checkout.** A price and stock re-check, the Stripe Checkout session, and the success page.
6. **Deploy.** Vercel project, env vars, the `halloween.supply` domain, and the daily refresh cron.

## Environment

The key names are in `.env.local`. Oscar fills them in.

| Variable | Source |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic Console → Settings → API keys |
| `FIRECRAWL_API_KEY` | Existing Firecrawl account |
| `TURSO_DATABASE_URL` | Vercel Marketplace Turso connection |
| `TURSO_AUTH_TOKEN` | Vercel Marketplace Turso connection |
| `STRIPE_SECRET_KEY` | Stripe → test key for development, live key for real orders |


## Risks and open items

- **Unpriced shipping.** The total covers merchant prices only, so the concierge absorbs shipping from each merchant. We need a policy before real volume.
- **Halloween timing.** An order placed in late October from several merchants may not arrive by Oct 31. Bay Area pieces could be picked up locally, which is another reason to show the support-local badge.
- **Price drift and stock-outs.** The checkout re-check catches most of them. For the rest, the concierge absorbs small differences and refunds any piece that sells out.
- **Hackathon rules.** The event page doesn't say whether code written before the event is allowed. Check the full rules before we build ahead of the day. Also, every track's criteria mention "solves a real conference problem," which this product doesn't target, and we've chosen not to bend the product to fit.

## Later

- More costumes, then "build your own costume" from a typed description.
- Creative visualization: a 3D costume model (as on paradigm.xyz's frontiers-2026 merch page) and virtual try-on.
- A concierge fee or margin, shipping estimates, and fulfillment tooling (eventually an agent that places the orders).
