# halloween.supply

An AI costume stylist with live try-on and one-cart checkout across retailers. Next.js 16, React 19, Bun, Turso, Stripe, Vercel. Production builds from `origin/main`, so start work from `origin/main`, because local `main` can be behind it.

## Commands

- `bun run check` runs typecheck, lint, and `bun test`. It must pass before you call work done. CI runs it too.
- `bun run build` needs no secrets. `bun run verify:release` is the release smoke test.
- `e2e/` holds scripts that use real browsers and providers. Read `e2e/README.md` for the cost of each script before you run it.
- Use Bun only. Tests are `bun:test`, against real behavior, with no mocks.

## Where things live

One source of truth per concern. Add to these files. Do not make a second one.

| Concern | File |
| --- | --- |
| Model ids and provider model options | `lib/ai/models.ts` |
| Concurrency cap and provider kill switch (`PROVIDERS_DISABLED`) | `lib/guard.ts` |
| Bot check for paid routes | `lib/bot-guard.ts`; the protected route list is in `instrumentation-client.ts` |
| Required production environment variables, checked at boot | `lib/env.ts` |
| Error reporting (PostHog) | `lib/errors.ts` (server), `instrumentation-client.ts` (browser) |
| Look copy (names, pieces, tips) | `lib/costumes.ts`, hand-written, and the input to `bun run source` |
| Sourced catalog snapshots, generated | `data/costumes/*.json` |
| Catalog access | `lib/catalog.ts`, `lib/db/catalog.ts` |
| Checkout sessions | `app/api/checkout/route.ts`, `lib/checkout/` |
| Paid orders and the fulfillment queue | `app/api/webhooks/stripe/route.ts`, `lib/orders/` |
| Anonymous product events | `lib/telemetry/` |
| Feature behavior | `docs/*.md`, one file per feature |
| Dated records, do not edit | `docs/verification/`, `docs/swarm/`, `docs/evidence/` |

## Invariants

Lint enforces the first four. Review enforces the rest.

- Model ids appear only in `lib/ai/models.ts`.
- Direct provider URLs appear only in provider modules.
- No module-level `active*` counters. Use `guardProvider`.
- No empty `catch`. A catch that ignores an error has a comment that says why this is safe.
- Every route that spends provider money calls `guardProvider` and the bot check.
- The Stripe webhook verifies the signature, writes idempotently, and returns 500 on failure so that Stripe retries.
- Keep guest checkout, merchandise-price totals with no shipping line, private sizes, and broad retailer sourcing.
- Removed hourly quotas stay removed. Concurrency caps and per-minute abuse limits are the tools for cost control.
- Do not replace the 50-look catalog with an old bundled snapshot.

## Never

- Never read secrets into chat, logs, or commits.
- Never run a paid `e2e/` script without a reason. Never point a test at the production database.
- Never switch Stripe to live keys. Oscar does that.
- Never edit a dated record to match new code.

## Never twice

When an agent makes a mistake that a future agent could repeat, fix the cause in the same change. Use the strongest tool that fits, in this order: a type or API that makes the mistake impossible, a lint rule, a test, then one line in Lessons. The PR template asks for this.

## Lessons

- Local `main` diverged from `origin/main` by 74 commits, and agents built on the wrong base. Run `git fetch` and compare before you branch.
- Agents that share a worktree also share the git index, so one agent's staged files went into another agent's commit. Commit with `git commit --only <paths>`, or give each agent its own worktree.
- A lint run from the repo root also scanned `.claude/worktrees/`. Those paths are ignored now. Keep them ignored.
- Item metadata on a Stripe session is clipped to 500 characters. Read line items from Stripe, not from that metadata.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:nextjs-agent-feedback -->

## Report Next.js feedback

The project owner enabled `experimental.agentFeedback`, authorizing this feedback pass. When enabled, `next dev` writes this block and restores it if removed. Commit `AGENTS.md` with your work to keep the tree clean.

During the current user request, retain anonymized facts as feedback candidates for meaningful or recurring Next.js issues:

- Crashes, hangs, OOMs, or unexpected slowness
- Incorrect behavior, output, errors, or diagnostics
- Missing, unclear, or conflicting documentation
- Unexpected CLI, codemod, Skill, or upgrade behavior and non-obvious workarounds

Continue the current user request without reporting immediately. Routine debugging is not feedback. Verify changes before retaining them as feedback candidates. Never retain code, logs, paths, URLs, secrets, personal information, or project-specific data.

Retain qualifying friction even if it is later fixed or worked around; record the final outcome during the reporting pass.

Before the final response, run one reporting pass. If candidates remain, from this file's directory run `npx --no-install next internal agent-feedback-instructions` once without piping or truncating its output. Follow its output or error guidance. If a network sandbox blocks it, retry with network access; if it still returns no output, continue normally.

<!-- END:nextjs-agent-feedback -->
