# Production release verification — November 6, 2026

The three campaign PRs merged in order. Production serves the combined application
at [halloween.supply](https://halloween.supply). Shopping and live video checks pass
within the scopes below. Provider access, one sold-out kit, and physical-device
evidence remain open.

## Release and review

| PR | Reviewed head | Merge commit |
| --- | --- | --- |
| [#33](https://github.com/ohong/halloween-supply/pull/33) | `8f3645b` | `f6d40e3` |
| [#34](https://github.com/ohong/halloween-supply/pull/34) | `44ef957` | `57c699a` |
| [#35](https://github.com/ohong/halloween-supply/pull/35) | `49736a3` | `311a8f7` |

Both child PRs were retargeted to main before merging. Merge commits preserved
ancestry. Each calculated merge tree matched its reviewed head exactly. Squashing
the parents would have required rebuilding the child diffs.

The current review found zero Standards release blockers and zero Spec release
blockers. The earlier structured reviews were clean on these unchanged source
heads. No review threads were open. Known incomplete provider and hardware
conditions stayed explicit; review did not convert them into successful checks.

Vercel deployment `dpl_ozRQdicD289XT39sDBxFjTQ9uCSL` is READY and owns the production
domain. Its commit is `311a8f7355d6f3b7fe6c61a3fae6bc129879bbd1`.
The custom domain reported that exact commit before and after each verification
lane. [Main CI passed](https://github.com/ohong/halloween-supply/actions/runs/42188502734).
This report's follow-up changes verification scripts and evidence only.

## Observed results

| Boundary | Result | Evidence and limit |
| --- | --- | --- |
| Catalog and database reads | Passed 55 checks | All 50 catalogs, 242 components, 556 served images, bundled parity, and read-only database catalog parity. Matching data does not establish database identity. |
| Model gallery | Passed | All 100 reviewed assets match their hashes, decode, retain transparency, and appear on the 50 detail pages. |
| Shopping browser | Passed 12/12 groups | Save/reload/share, exact carts, repair gates, event privacy, and 390px layout. Zero uncaught browser errors. |
| Completion kits | Nine ready; one blocked | Ready kits charge their exact current products and subtotal. Linen Ghost blocks its sold-out sheet. Ten outcomes were checked; ten kits are not currently purchasable. |
| Search | One HTTP 200 semantic response | Upstream provider calls and cache use are not observable from that response. |
| Cart recovery UI | Passed four response fixtures | Unrelated lines survive; sizes, alternatives, and accepted prices remain explicit. These fixtures do not prove merchant success. |
| Real Stripe checkout | Passed one $10 USD TEST session | Current pinned merchant variant, exact line, unpaid status, and expiry were verified. No payment occurred. |
| Saved-board boundaries | Passed 17 checks | Configured unsigned, forged, unsafe-URL, origin, size, and reference guards. No new saved record was written. |
| Curated photo preview | Provider HTTP 429 | One valid synthetic photo and five current products reached the provider path. No image returned; no retry. |
| Live garment video | Decoded 1280×720 frames | One token, one peer, synthetic camera only. All tracks and connections closed. No fidelity claim. |
| Typed mirror command | HTTP 503: account credit required | One actual command; no retry. Manual piece selection remains available. |
| Clip input | Disabled | Its availability and POST guard passed. No video model has qualified. |
| Health | HTTP 200, correctly degraded | Database reads and all 50 catalogs work. Facts include 62 stale products, six unknown stock records, and 14 recorded out of stock. |

The browser emitted 53 allowlisted events across 14 isolated journeys. Production
signature checks returned 400 for unsigned/forged products and six unsafe URL
forms. This differs from the earlier unconfigured local 503 guard.

A deployment-scoped host query also found 103 telemetry log entries at
`/api/events` during the verification window. This includes the initial run and
diagnostics, so it is not a count of the final suite alone. Host collection is
observed; export and retention remain unverified.

One Camera Ready Cosmetics offer confirmed unforced USD and stock before the
actual checkout. The exact one-line Stripe TEST session totaled 1,000 cents. It
was retrieved, expired, and retrieved again as expired and unpaid. An earlier
Benzie merchant currency preflight failed before any checkout POST. That result
applies to that merchant; it does not establish a Stripe failure.

Video timings were 2.83 seconds to provider connection and a further 1.77 seconds
to the first decoded frame. These are one-session transport observations. A
synthetic test pattern produced a generated figure, so the result cannot establish
garment accuracy or identity preservation. No microphone or personal camera ran.

## Verification corrections

The first hosted catalog run passed 54 groups but rejected health's `degraded`
status. Its old assertion treated a connected database as sufficient for `ok`.
The checker now recomputes stored facts and verifies the exact resulting status.
Database connectivity, source, parity, and coverage remain strict. The rerun
passed 55 groups.

The first shopping run passed 9/12 groups. Its price-filter check read the initial
50 cards before the changed status rendered. Its kit loop assumed every stored
product was still in stock. The missing filter event then caused a dependent
measurement failure. Diagnostics found no persistent lost interaction or browser
exception.

The verifier now waits for the visible processed price status, checks stock
rejection explicitly, and resolves shared-fixture prices from the published
catalog. It records a price-target miss instead of silently changing a kit.
The rerun passed 12/12 with nine ready kits, one correct stock guard, and no
price-target misses. No application behavior changed to obtain these results.

## Remaining blockers and next evidence

| Priority | Condition | Next evidence needed |
| --- | --- | --- |
| 1 | Mirror commands need OpenAI account credit. Photo preview returned provider 429. | Restore command account availability and diagnose the image endpoint's rate or usage limit. Rerun one real command and one valid photo. The photo route does not expose the exact upstream cause. |
| 2 | Linen Ghost kit sheet `p-734febc080` is recorded sold out. | Confirm that exact offer or research a replacement. Keep kit application and purchase blocked until the selected product is eligible. |
| 3 | 62 product facts are older than 36 hours; six stock records are unknown. | Inspect failed refresh offers and verify affected merchants. No automatic bulk refresh or catalog write ran during this release check. Delivery remains unconfirmed. |
| 4 | Fresh hosted saved-board persistence was not retested. | Confirm the production database connection identity, then run one synthetic create/reload/reference test with deterministic cleanup. Matching catalog data and receipt signing are insufficient identity proof. |
| 5 | Successful missing-piece retry and saved-board personal preview remain unverified. | Run the complete saved screenshot journey after persistence identity and provider availability are established. Curated validation alone does not prove that journey. |
| 6 | Forced relay and physical phone behavior remain unverified. | Configure usable TURN credentials, then test a physical iPhone/Safari on another network, including lens flip, reconnect, capture, and stop. Synthetic direct checks remain separate. |
| 7 | Clip provider qualification remains blocked. | Qualify an explicit video model with a real upload and YouTube input before enabling the flag. |
| 8 | Garment/identity fidelity, real speech, and paired command latency remain unverified. | Inspect output from suitable consenting inputs and collect comparable before/after command timings. Decoded frames and sent controls are insufficient. |
| 9 | Log export and retention remain unverified. | Confirm host log retention and export. Scoped deployment error/fatal queries returned no logs during the observed window; drain inspection returned 404. |

The saved-board identity check used existing development credentials without
retrieving production secrets. It made zero persistence writes. The existing
persistence helper also needs safer cleanup after an unknown POST outcome before
it is reused in production; its current cleanup depends on receiving a record ID.

Real-money fulfillment, tax/shipping economics, the separate Gemini voice PR,
competition report, COOL claims, and the user-owned submission remain outside this
release verification. Stripe is still TEST mode.

## Reproduction and retained evidence

The catalog check used the existing local development environment for SELECT-only
parity. Credentials were not printed or copied. Commands ran from the release
worktree:

```sh
bun --env-file=/Users/ohong/dev/halloween-supply/.env.local scripts/verify-full-catalog.ts https://halloween.supply
bun --no-env-file scripts/verify-model-gallery.ts https://halloween.supply
SHOPPING_EVIDENCE_DIR=/tmp/halloween-production-2026-11-06/campaign/final bun scripts/verify-shopping-campaign.mjs https://halloween.supply
```

Bounded checkout, saved-boundary, photo, and mirror harnesses ran from
`/tmp/halloween-production-2026-11-06/`. Their sanitized receipts retain attempts,
outcomes, cleanup, and limits. Temporary session references were removed after
expiry. No catalog mutation, paid transaction, schema change, or new service ran.

Retained evidence:

- [Release and merge receipt](production-2026-11-06/release.json)
- [Catalog](production-2026-11-06/catalog-summary.json), [browser outcome](production-2026-11-06/campaign-outcome.json), [all browser checks](production-2026-11-06/campaign-summary.json)
- [Stripe cleanup](production-2026-11-06/checkout.json), [saved boundaries](production-2026-11-06/look-state.json), [photo response](production-2026-11-06/preview.json), [video and command](production-2026-11-06/mirror.json)
- [Mobile storefront](production-2026-11-06/discovery-mobile.png), [exact kit cart](production-2026-11-06/kit-exact-cart.png), [sold-out kit guard](production-2026-11-06/linen-ghost-stock-guard.png)
