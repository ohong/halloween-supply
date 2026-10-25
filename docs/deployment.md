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
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `STRIPE_SECRET_KEY`
- `CRON_SECRET`

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
Stripe remains in test mode for the five-costume demo. Do not replace the production credential with a live key without a new user instruction.

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

1. Run `bun run lint` and `bun run build`.
2. Run `bun scripts/verify-costumes.ts LOCAL_URL --checkout --all-options --chat` against the local production server.
3. Push the reviewed commits to `main`.
4. Inspect the resulting Vercel deployment and confirm the commit and `READY` state.
5. Check `https://halloween.supply/api/health`.
6. Seed any updated live database catalogs after their image assets resolve on the production host.
7. Run `bun scripts/verify-costumes.ts https://halloween.supply --checkout --all-options --chat`. Every verification session is test-only and expires unpaid.

`/api/health` returns names and booleans for environment variables, database counts,
completeness and source for each of the five catalogs, and the deployed Git commit.
It returns HTTP 503 when the served catalog lacks a default and two alternatives per piece.
An available snapshot with an unreachable database reports `degraded` instead of claiming database success.

The health check does not test Anthropic, Firecrawl, or Stripe credentials.
Their names being present is not evidence that provider requests succeed.
