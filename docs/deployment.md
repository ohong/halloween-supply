# Deployment

The existing Vercel project is `halloween-supply` in `ohong-projects`.
Its production branch is `main`. A push to `main` starts a production deployment.
The verified production domain is `halloween.supply`.

The project uses Node.js 24 and the Next.js Node runtime.
Cache Components selects that runtime; route files must not export `runtime`.

## Environment

Production needs these variables:

- `ANTHROPIC_API_KEY`
- `BRIGHTDATA_API_KEY`
- `BRIGHTDATA_SERP_ZONE`
- `BRIGHTDATA_UNLOCKER_ZONE`
- `FALKORDB_URL`
- `STRIPE_SECRET_KEY`
- `CRON_SECRET`

On October 24, 2026, all seven were already present as production secrets.
The existing CLI login can manage this project without a `VERCEL_TOKEN`.
The connected Vercel tool can inspect deployments and domains; its environment permissions are restricted.
Use the authenticated CLI for environment metadata:

```sh
vercel env ls --environment production --scope ohong-projects --project halloween-supply
```

Do not pull environment files over `.env.local` or print credentials.
The production Stripe credential was a test key during the initial inspection.
Real payments require a live Stripe key before accepting customer orders.

## Daily catalog refresh

`vercel.json` schedules `/api/cron/refresh` each day at 10:00 UTC.
Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically.
The handler rejects missing or incorrect credentials and never caches responses.

The refresh reads the live graph, checks merchant prices and stock, and updates verified products.
It expires the `catalog` cache tag after graph writes.
An unreachable graph or zero verified products returns HTTP 503.
A partial merchant refresh returns HTTP 207 with counts and failed product IDs.
A full refresh returns HTTP 200.

Vercel does not retry failed cron invocations. Inspect function logs after a failure,
then invoke the endpoint again with the secret through a script or the Vercel dashboard.
Never place the secret in the URL or paste it into logs.

## Release verification

1. Run `bun run lint` and `bun run build`.
2. Verify the local checkout and assistant with real provider calls.
3. Push the reviewed commits to `main`.
4. Inspect the resulting Vercel deployment and confirm the commit and `READY` state.
5. Check `https://halloween.supply/api/health`.
6. Confirm the home page, costume page, assistant and checkout against production.

`/api/health` returns names and booleans for environment variables, graph counts,
catalog completeness, catalog source, and the deployed Git commit.
It returns HTTP 503 when the served catalog lacks a default and two alternatives per piece.
An available snapshot with an unreachable graph reports `degraded` instead of claiming graph success.

The health check does not test Anthropic, Bright Data, or Stripe credentials.
Their names being present is not evidence that provider requests succeed.
