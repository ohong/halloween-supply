# Deployment

The existing Vercel project is `halloween-supply` in `ohong-projects`.
Its production branch is `main`. A push to `main` starts a production deployment.
The verified production domain is `halloween.supply`.

The project uses Node.js 24 and the Next.js Node runtime.
Cache Components selects that runtime; route files must not export `runtime`.

## Environment

Production needs these variables:

- `ANTHROPIC_API_KEY`
- `FIRECRAWL_API_KEY`
- `OPENAI_API_KEY` for screenshot understanding, photo previews, and mirror voice
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `CRON_SECRET`

`FAL_KEY` enables live video and personal 3D previews. Phone relay needs the
optional Metered variables described in [phone camera](phone-camera.md).
Saved-board receipts use `SAVED_LOOK_SIGNING_SECRET` or `TURSO_AUTH_TOKEN`; replicas
must share the value. Without either, saving reports unavailable and keeps found
pieces on the current board. Clip input stays off until a real video request
qualifies an explicit model; see [clip sourcing](clip-sourcing.md).

Turso injects its connection variables through the Vercel Marketplace integration.
The dedicated database uses the Starter plan ($0/month) in iad1.
Firecrawl uses the existing account key, saved as a Vercel Secret.
The existing CLI login can manage this project without a `VERCEL_TOKEN`.
The connected Vercel tool can inspect deployments and domains; its environment permissions are restricted.
Use the authenticated CLI for environment metadata:

```sh
vercel env ls --environment production --scope ohong-projects --project halloween-supply
```

Do not pull environment files over `.env.local` or print credentials.
Stripe remains in test mode for the 50-costume storefront. Do not replace the production credential with a live key without a new user instruction.

## Launch guards

Three guards protect the site before it takes real traffic.

**Environment check.** On boot in production, `instrumentation.ts` calls `lib/env.ts` and logs one
`[env] Missing required production environment variables: ...` line with names only. It reports the same
to PostHog and does not throw, so pages that do not need the variable keep working. The required list is the
one under Environment above. Separately, if `STRIPE_SECRET_KEY` starts with `sk_live` and
`STRIPE_WEBHOOK_SECRET` is unset, `POST /api/checkout` answers 503, so no real payment can go unrecorded.

**BotID.** Paid POST routes call `rejectBot()` from `lib/bot-guard.ts` first and answer 403 to bots. The
routes are listed in `instrumentation-client.ts`. Enable BotID for the Vercel project (Firewall tab; Deep
Analysis is recommended). Outside Vercel and in `next dev` BotID reports a human, so enforcement only exists
on a deployment. If the BotID check itself errors, the request is allowed and the error goes to PostHog.
`BOT_CHECK_DISABLED=1` turns the check off. Hosted Playwright and curl `e2e/` scripts count as bots: set
`BOT_CHECK_DISABLED=1` on the preview they target, or use Vercel's protection bypass for automation.
Local runs against `next start` are not blocked (the check errors and fails open).

**PostHog error tracking.** Set `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` (your
region's ingestion host; there is no default). With either unset PostHog stays off and the app runs normally.
Only exceptions are captured: no session recording, autocapture, pageviews, cookies or storage. Server errors
come from `onRequestError`, plus `captureError()` in the Stripe webhook and the paid routes' catch blocks.
After deploying, create an error tracking alert in PostHog (Error tracking, Alerts) that notifies you on new
issues, and confirm one test error appears.

Open items: source maps are not uploaded, so production stack traces are minified. Set that up with the
PostHog source map upload for Next.js when needed.

## Stripe webhook

Paid orders are recorded by `POST /api/webhooks/stripe`. In the Stripe dashboard (Developers, Webhooks), add an
endpoint at `https://halloween.supply/api/webhooks/stripe` for `checkout.session.completed` and
`checkout.session.async_payment_succeeded`, then save its signing secret as `STRIPE_WEBHOOK_SECRET`.
Test and live mode have separate endpoints and secrets.

Each paid session becomes one row in the Turso `orders` table, and rows with `fulfillment_status = 'pending'`
are the fulfillment queue. Redelivery is a no-op. The route sets `receipt_email` on the payment intent, which
makes Stripe email the receipt in live mode (test mode sends no email). A database or Stripe failure answers
500 so Stripe retries. For local testing use `stripe listen`; see `e2e/verify-stripe-webhook.ts`.

## Demo sizes

Stripe test checkout accepts missing sizes and records `M` (Medium) for them.
The cart labels these as demo defaults and keeps Checkout enabled. Explicitly
chosen sizes still use exact merchant validation; one-size pieces stay one size.
The assistant does not require size entry during this demo.

Medium is a demo placeholder, including for numeric-size pieces. It is not a
claim that a merchant stocks Medium. Defaulted lines still check live price and
stock without requiring a specific size and carry `size_defaulted_for_demo` in
Stripe metadata. Live-money checkout keeps its explicit-size requirement.

## Daily catalog refresh

`vercel.json` schedules `/api/cron/refresh` each day at 10:00 UTC.
Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically.
The handler rejects missing or incorrect credentials and never caches responses.

The refresh reads the live database, checks merchant prices and stock, and updates verified products.
It expires the `catalog` cache tag after database writes.
An unreachable database or zero verified products returns HTTP 503.
A partial merchant refresh returns HTTP 207 with counts and failed product IDs.
A full refresh returns HTTP 200.

Vercel does not retry failed cron invocations. Inspect function logs after a failure,
then invoke the endpoint again with the secret through a script or the Vercel dashboard.
Never place the secret in the URL or paste it into logs.

## Release verification

1. Run `bun run lint`.
2. Run `bun run typecheck`.
3. Run `bun run build`.
4. Run `bun run verify:release` for all 50 catalogs, images, model assets, and browser shopping checks.
5. Run `SHOPPING_EVIDENCE_DIR=/tmp/shopping-evidence bun e2e/verify-shopping-campaign.mjs LOCAL_URL` against a separate local production server.
6. Confirm the exact PR heads pass hosted checks in the [stack order](swarm/2026-11-05/pr-stack.md).
7. Merge reviewed commits only after the user authorizes the release.
8. Confirm the resulting Vercel deployment's exact commit and `READY` state.
9. Check `https://halloween.supply/api/health`.
10. Publish any authorized catalog changes after their image assets resolve on the production host.
11. Run authorized live-provider and checkout checks separately.

The older `verify-costumes.ts` covers only five looks. Its `--checkout` and
`--chat` modes invoke external services and do not replace the all-50 baseline.
Every checkout verification session must remain test-only and expire unpaid.
The credential-free CI baseline does not exercise those services.

`/api/health` returns names and booleans for environment variables, database counts,
completeness and source for each of the 50 catalogs, and the deployed Git commit.
It returns HTTP 503 when the served catalog lacks a default and two alternatives per piece.
An available snapshot with an unreachable database reports `degraded` instead of claiming database success.

The response also separates stock/price freshness from structural completeness.
Refresh history is not persisted. Stale or unknown facts make status `degraded`
without implying that structurally complete catalogs are absent.

The health check does not test Anthropic, Firecrawl, OpenAI, or Stripe credentials.
Their names being present is not evidence that provider requests succeed.
