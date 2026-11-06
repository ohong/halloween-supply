# Release checks

The `Quality` workflow checks pull requests, pushes to `main`, and manual dispatches. It installs the locked dependencies, runs lint and type checks, builds the app, and checks a local production server.

This workflow verifies the bundled catalog without credentials. It does not deploy the app or create payment sessions.

## Commands

Run the full local sequence from a clean checkout:

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run build
bunx --no-install playwright install --with-deps chromium
bun run verify:release
```

`verify:release` requires an existing production build. It starts `next start` on an unused loopback port and stops that server after success or failure. It does not rebuild the app.

To check a production server that is already running locally:

```sh
bun run verify:release --url http://127.0.0.1:3300
```

The existing server must report the bundled catalog and no database configuration. The checker rejects remote origins, credentials in URLs, paths, and query strings.

To run the existing catalog checker separately:

```sh
bun run verify:catalog http://127.0.0.1:3300 --allow-database-down
```

This separate command retains the existing live database parity check when database credentials are supplied. `--allow-database-down` permits only explicit snapshot fallback; it does not claim database readiness.

## What the baseline proves

| Check | Observable result |
| --- | --- |
| Frozen install | The committed Bun lockfile matches the package manifest. |
| Lint and types | Existing ESLint rules and Next-generated route types pass. |
| Production build | `next build` completes with the committed app. |
| Full catalog | Every editorial look has a valid bundled snapshot and working shopping page. All 50 homepage links appear. |
| Product and costume images | Referenced local images decode and their served bytes match disk. Cutouts retain transparency. |
| Model gallery | All 100 reviewed model assets decode, retain transparency, and match their recorded hashes and served bytes. |
| Browser state | A saved look survives reload. The saved filter opens that look. A whole-costume cart survives reload and supports removal and product replacement. |
| Desktop and phone | The checked page and cart fit 1440px and 390px viewports without horizontal overflow. The browser throws no runtime exceptions. |

The browser checker aborts external requests and writes, except for valid anonymous events sent to the same-origin `/api/events` endpoint. Event bodies must pass the shared schema. Other attempted writes fail the check. The checker does not replace app APIs with successful responses.

The runner removes inherited provider credentials. It also reserves dotenv variable names with empty values before starting the server. Health must confirm the fallback catalog before verification continues. `TELEMETRY_DISABLED=1` keeps synthetic events out of server logs.

## CI permissions and evidence

Actions use exact commit pins, verified against their official release tags on 2026-11-05:

- [actions/checkout v4.2.2](https://github.com/actions/checkout/releases/tag/v4.2.2)
- [actions/setup-node v4.4.0](https://github.com/actions/setup-node/releases/tag/v4.4.0)
- [oven-sh/setup-bun v2.0.2](https://github.com/oven-sh/setup-bun/releases/tag/v2.0.2)
- [actions/upload-artifact v4.6.2](https://github.com/actions/upload-artifact/releases/tag/v4.6.2)

The workflow has `contents: read` permission and disables persisted checkout credentials. It uses `pull_request`, not `pull_request_target`, and references no repository secrets. Fork pull requests can run the same checks.

CI retains only an explicit list of public screenshots, the check summary, and bounded browser diagnostics for seven days. Error messages retain their first line and React error code, with stacks and URL query values removed. Event payloads are never retained. CI does not upload dotenv files, server logs, browser storage, traces, or authentication state. Evidence is written under `tmp/verification/release/`.

## Design choice

Two approaches were considered. A new complete Playwright suite could duplicate catalog and image assertions. Reusing the existing read-only verifiers keeps those strict checks in one place.

The chosen runner adds only the missing production-server lifecycle and focused browser state checks. Campaign-specific QA can extend this command once its runtime contracts are stable.

## Evidence from this change

| Command or check | Result |
| --- | --- |
| `bun run lint` | Passed. |
| `bun run typecheck` | Passed after Next generated route types. |
| `bun run verify:release --help` | Passed. |
| Remote URL and non-root URL rejection | Passed; both exited with status 1. |
| Missing production build | Passed; the runner exited with a clear build prerequisite message. |
| Ruby YAML parser | Passed; the workflow contains the expected quality job. |
| `git diff --check` | Passed. |
| Initial production runtime baseline | Catalog, model images, saved state, cart restoration, and product swaps passed. The strict error check found React hydration error 418 when the restored cart opened immediately. |
| Hydration fix | The cart drawer now matches its server fallback until its own hydration finishes. No test delay or error suppression was added. Production verification of this fix is pending the root rebuild. |
| Hosted GitHub Actions | Not run in this task. |

No qualifying Next.js feedback candidate was observed during this change.

## Release limits

These checks do not establish live database health, merchant stock or prices, Stripe readiness, model quality, camera behavior, or physical-device behavior. The bundled fallback is the expected CI source.

A passing local baseline does not prove hosted CI or production. Confirm the exact release commit, required hosted checks, and relevant live integration checks before a release.
