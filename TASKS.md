# halloween.supply v1 — TASKS

**Goal.** Ship brief.md's v1 finish line on https://halloween.supply.

**Finish line.** On production: home → cosmic-cowboy → swap a piece → tell the assistant sizes → cart → Stripe test checkout (4242…) → success. The Stripe session carries merchant, product URL and size per piece. `bun run build`, `bunx tsc --noEmit`, `bun run lint` pass. Verified at 375px and 1440px.

## Preflight (done 2026-10-24)
- [x] .env.local has all six keys; STRIPE_SECRET_KEY is sk_test_.
- [x] SERP probe: `udm=28` → 40 shopping results, all priced. `--tbm` → empty body (JSON parse error). Use udm. Shopping links are google.com/search?ibp=oshop redirects, not merchant URLs.
- [x] `bun run warm` against FalkorDB Cloud: answered, skeleton seeded (5 pieces, 0 products).
- [x] Vercel linked; production env has the six keys + generated CRON_SECRET.
- [x] `claude-sonnet-5-5` is in Anthropic's model list.

## Milestones
- [ ] M1 Real data: source cosmic-cowboy (5×3 products, 0 blocked, ≥2 Bay Area, one merchant with 2 pieces), seed graph. — worker `data`
- [ ] M2 Storefront: tokens, mosaic, costume page, cart. — worker `storefront`
- [ ] M3 Assistant: /api/chat, tools, panel. — worker `assistant`
- [ ] M4 Checkout: /api/checkout, Stripe, success, cron. — worker `checkout`
- [ ] M5 Ship: build/tsc/lint, fresh review, push, prod E2E at 375/1440, Stripe metadata check.
- [ ] M6 Polish: editorial cowboy tile photo.

## Next step
Workers running; review and commit each diff as it lands.
