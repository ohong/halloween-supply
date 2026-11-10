# Halloween Supply

Halloween Supply helps shoppers build a recognizable costume from individual
pieces. The curated catalog contains 50 looks. Each purchasable component has
three price tiers: $, $$, and $$$. Shoppers can compare merchants, swap pieces,
use clothing they own, ask the budget stylist, preview a look, and use guest
checkout.

Updated November 6, 2026, for the campaign that started November 5. Halloween has passed.
Event readiness uses the shopper's event date; it does not promise an October 31
arrival. The [campaign ledger](docs/swarm/2026-11-05/README.md) records implementation,
verification, and remaining dependencies for the ten approved improvements.
PRs #33, #34, and #35 merged in order. Production application commit `311a8f7`
passed hosted shopping and catalog checks. The
[production report](docs/verification/production-2026-11-06.md) records provider
failures, stock limits, and the remaining unverified paths.

## Shopping paths

- The gallery supports local filtering, semantic search, Saved looks, and a
  persistent male or female presentation preference.
- Curated costume pages show product photos, merchant prices, alternatives,
  owned pieces, optional pieces, and the generated inspiration image.
- Create plans and saves an unlisted product board in Turso. Custom looks use real
  product photos and report missing pieces. They do not join the reviewed catalog.
- Screenshot sourcing streams discovered candidates before all merchant checks
  finish. A candidate is distinct from an offer that can enter the cart.
- Photo try-on produces an approximate visual preview. Live mirror features add
  optional voice, typed commands, and transformed video when their providers work.

The campaign adds completion kits, complete saved selections, event notes,
saved-board photo preview, checkout recovery, phone diagnostics, mirror control
measurements, anonymous funnel events, release checks, and gated clip input.
Read the ledger before claiming that a campaign path passed runtime checks.

Ten completion kits select defining pieces and state owned basics. Their stored
new-piece subtotals range from $13.50 to $98.39 before supplies, tax, and shipping.
Owned items are prerequisites. Delivery remains unconfirmed for all ten kits.
On November 6, nine kits are eligible; Linen Ghost blocks its sold-out sheet.
See [kit evidence](docs/swarm/2026-11-05/kits.md) for fit, assembly, and stock limits.

Clip input is off unless `CLIP_COSTUME_ENABLED=1` and an explicit
`GEMINI_CLIP_MODEL` are configured. Current video probes did not qualify a model.
The disabled feature preserves the screenshot path. See
[clip sourcing](docs/clip-sourcing.md) for the observed provider errors and limits.

## Catalog and checkout

Turso stores one validated JSON catalog per costume. `lib/catalog.ts` supplies
pages, assistant tools, and checkout. Bundled catalogs provide a read fallback.
Publication and refresh must preserve all 50 catalogs and unrelated product facts.

Sourcing permits retailers and marketplaces, including larger merchants.
Products still need direct merchant evidence and valid product URLs. URL safety,
short-link rules, relevance checks, and checkout verification remain in force.
The accepted broader policy is deployed through #33. Each offer still needs its
own merchant verification.

Checkout rechecks current merchant price, stock, and size. Shoppers must accept
price changes. The total is the sum of merchant prices: no markup, concierge fee,
or shipping line. The concierge absorbs merchant shipping. Stripe collects email
and a US shipping address. Fulfillment remains manual.

The cart focuses the failing item and offers confirmed size labels or catalog
alternatives while preserving unrelated lines. Health separates catalog structure
from fresh, stale, and unknown merchant facts. Refresh summaries are returned to
the caller; they are not stored as a refresh history. See
[checkout recovery](docs/checkout-recovery.md).

Checkout does not reserve merchant inventory or guarantee arrival. An unpaid
Stripe test session proves session creation only. It proves neither payment nor
fulfillment. A real-money launch needs a separate fulfillment and shipping policy.

## Image analysis and media

Screenshot sourcing uses `gpt-6-luna` by default. `SCREENSHOT_VISION=opencv` adds
OpenCV segmentation, color measurements, and product-photo scores. Luna still
labels garments. If OpenCV is unavailable, screenshot sourcing uses the Luna path;
unscored matches can require shopper approval. See
[screenshot sourcing](docs/screenshot-sourcing.md) and the
[vision service contract](vision/README.md).

The service runs SegFormer segmentation and CLIP image embeddings through
`cv2.dnn`. Its source exposes `/healthz`, `/v1/analyze`, and `/v1/match`.
Analyze returns garment regions, colors, crops, outlines, and embeddings. Match
returns scores, verdicts, and reasons that guide search retries or shopper approval.
The service source supports stock OpenCV and a COOL container. Historical stock
service measurements are recorded in the screenshot notes. This campaign does
not verify an active COOL deployment or a COOL performance advantage. The stale
[competition docs PR #27](https://github.com/ohong/halloween-supply/pull/27)
needs a separate evidence review; see the [open-loop ledger](docs/swarm/2026-11-05/open-loops.md).

Photo try-on, GPT Live voice, fal/Lucy video, and phone WebRTC are separate paths.
A configured provider does not prove a successful session. Browser simulation
does not prove physical iPhone or Safari behavior. See
[phone camera](docs/phone-camera.md), [live mirror](docs/live-costume-mirror.md),
and the campaign evidence.

The app has no hourly demo quotas. `TRY_ON_TESTING_MODE=1` removes app session
cutoffs for rehearsal. Normal mirror connections have a three-minute cutoff.
Provider limits, upload bounds, consent, timeouts, and limits on simultaneous work
still apply. See [session behavior](docs/mirror-session-limits.md).

## Privacy

Saved selections, cart choices, sizes, and presentation preferences use browser
storage. Public look links must exclude private sizes, photos, and generated
previews. Standard photo previews keep image state in page memory.

Anonymous funnel measurement uses a random identifier in `sessionStorage`.
Allowlisted event fields cover actions, fixed categories, timings, and usage
units. They exclude photos, prompts, raw searches, addresses, IP addresses, phone
tokens, and raw error messages. Hosting access logs are separate and can include
connection information. Event retention follows hosting settings; this campaign
does not verify that retention period. See the site's Privacy page and
[measurement notes](docs/swarm/2026-11-05/measurement.md).

## Run

```sh
bun install
bun run dev
```

Open `http://localhost:3000`. For a production build, run `bun run build`, then
`bun run start`. Read the relevant Next.js guides in `node_modules/next/dist/docs/`
before changing application code.

The core service variables are `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`FIRECRAWL_API_KEY`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `STRIPE_SECRET_KEY`,
and `CRON_SECRET`. Optional OpenCV uses `VISION_SERVICE_URL` and
`VISION_SERVICE_TOKEN`. Live transformed video uses `FAL_KEY`.
Phone relay and clip configuration are described in their feature documents.
Keep credentials in local and deployment environments. Never commit them.

## Verify

```sh
bun run lint
bun run typecheck
bun run build
bunx --no-install playwright install --with-deps chromium
bun run verify:release
# For separate real-service checks, start the production server:
bun run start
# With the production server running:
bun e2e/verify-full-catalog.ts http://localhost:3000
bun e2e/verify-model-gallery.ts http://localhost:3000
bun e2e/verify-v1.ts http://localhost:3000 --checkout
bun e2e/verify-chat.ts http://localhost:3000
bun e2e/verify-costume-search.ts http://localhost:3000 --require-semantic
```

Some checks call real services and consume credits. The checkout check creates
and expires an unpaid test session. It needs the Stripe key for the same account
as the running app. Do not run checkout checks against a live-money account.
Exact campaign commands, results, and limits belong in the
[release evidence](docs/swarm/2026-11-05/README.md).

`verify:release` checks a local production build with credentials removed and the
bundled catalog. It does not call paid providers, create checkout sessions, or
deploy. See [release checks](docs/swarm/2026-11-05/release-checks.md) for its scope.

`/api/health` reports catalog structure, database status, configuration booleans,
and release identity without exposing credentials. Structural health does not
prove fresh merchant stock, successful inference, payment, or fulfillment.
The daily `/api/cron/refresh` route refreshes product facts and requires
`CRON_SECRET` authentication.

## Source and release

The repository is `ohong/halloween-supply`. The configured Vercel production URL
is [halloween.supply](https://halloween.supply). Publication uses the existing
repository and deployment process. Confirm the intended commit on the deployed
host and rerun critical shopping checks after any authorized release.

The [brief](brief.md) records product decisions. [TASKS.md](TASKS.md) links the
current work and open dependencies. Historical evidence remains dated; it is not
a substitute for checking the release candidate.
