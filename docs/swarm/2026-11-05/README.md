# November 5, 2026 campaign evidence

This ledger tracks the ten approved product improvements. The
[original review](original-review.md) was prepared October 27. Its live observations
and proposed schedule are historical. The campaign started November 5. This
ledger was updated November 6; event notes apply to the shopper's event date.

The integration baseline is `2062f165f397ff8d8a9cf5fbeb908e0561e9068b`
(PR #32). Work uses isolated branches. The existing dirty checkout and its accepted
merchant policy changes remain separate inputs to integration.
Owner hashes below identify lane commits. Integration uses cherry-picks, which can
have different hashes. No hash below is presented as a new deployed commit.

The [review stack](pr-stack.md) groups the changes into foundation, shopping look
continuity, and media/documentation layers. Kits, discovery, and destination
restoration stay together so the intermediate product has working kit links.

## Status meanings

- **Implemented:** the owner completed the source change. This alone does not
  establish integration, deployment, or provider success.
- **Verified:** a recorded check passed in the named runtime and scope.
- **Blocked:** a named external dependency or failed check prevents the remaining
  success condition. A bounded source change can still be implemented.

## Ten-item ledger

| # | Improvement | Implementation | Verification | Remaining condition |
| --- | --- | --- | --- | --- |
| 1 | Completion kits and price-aware discovery | Ten kit overlays and discovery implemented | 61 kit/catalog checks, all 50 discovery cards, and ten exact destination/cart totals passed | Prices remain stored catalog facts. New-piece subtotals depend on owned basics and exclude supplies, tax, and shipping. |
| 2 | Complete saved/shared selections | Backend and UI implemented, with explicit repair purchase gate (`3f309bd`) | Fresh-browser restoration, exact cart pruning, repair gating, backend validation, and synthetic persistence passed | Public links exclude private sizes and photos. Live database and browser evidence have separate scopes below. |
| 3 | Event and assembly readiness | Implemented with dated evidence for 28 purchase rows and general event dates | All ten kits resolve; default and 2026-12-31 event checks passed | Arrival unconfirmed for all ten; pickup inventory and physical assembly unverified. No sourced absolute late-arrival record exists. |
| 4 | Saved-board personal preview | Backend and UI implemented, including signed autosave and per-row retry | Saved-record persistence and server resolution verified with a signed synthetic record; UI lint passed | Blocked on OpenAI credit for generation and missing-piece retry. References are product names only; visual fidelity remains unverified. |
| 5 | Checkout recovery and freshness | Implemented (`7290881`) | Five local checks passed, including a real merchant invalid-size response; controlled browser failures are labeled | Unpaid/expired Stripe session and authorized refresh writes were not run. No production mutation occurred. |
| 6 | Phone camera connection | Implemented (`4f51bd9`, `d460168`) with Metered diagnostics, direct fallback, bounded recovery, source retention, and cleanup | Four synthetic Chromium runs passed; latest 16-check run confirms 11 decoded raw frames | Blocked: no TURN credentials. Forced relay, physical iPhone/Safari, separate networks, cellular handoff, and phone live inference remain unverified. |
| 7 | Mirror controls and timing | Implemented; independent follow-ups run together and stale responses are rejected | Seven browser fixtures, source/reference guards, and real Lucy synthetic transport passed | Blocked on OpenAI credit for real commands. No before/after latency comparison or garment/identity fidelity result. |
| 8 | Anonymous measurement | Implemented with allowlisted host logs and aggregate CLI | Helper/endpoint/stdout checks passed; integrated shopping clicks produced 53 valid events across 14 browser journeys | Actual preview/redirect funnel, production collection, host retention/export, provider usage, and billing remain unverified. |
| 9 | Release base and checks | Three-layer stack prepared; quality workflow and production runner implemented | Production build, strict baseline, and all 12 integrated shopping QA groups passed locally | Hosted GitHub Actions, preview commit verification, and production deployment remain unverified. |
| 10 | Gated clip input | Implemented, default off (`7243600`) | 24 route/input checks passed without provider calls; typecheck and focused lint passed | Blocked: video probes returned 503 busy, 404 unavailable, and 429 quota. No model qualified; full YouTube/upload sourcing remains unverified. |

The evidence below separates owner checks, the integrated local production
runtime, and external dependencies. A source implementation can be complete while
its provider or physical-device success condition remains blocked.

## Verification record

Documentation inspection completed:

```sh
git log -5 --oneline
git worktree list
gh pr view 27 --json number,title,state,headRefName,baseRefName,mergeStateStatus,updatedAt,body,url
```

These checks confirmed the selected source baseline and the open competition-docs
PR. They do not verify the shopping runtime or any provider. The app's health
endpoint and historical evidence have separate scope.

The integrated shopping checks and strict production baseline passed. See
[open loops](open-loops.md) for external dependencies and later release work.

### Integrated production checks

The [final shopping QA](qa.md) ran against the local production app at
`ce8f4c4cace862b6aa34718eb349e739a3dbc7cb`, with bundled catalog fallback and
no database or OpenAI keys:

```sh
SHOPPING_EVIDENCE_DIR=/tmp/halloween-shopping-campaign-patched-final bun scripts/verify-shopping-campaign.mjs http://localhost:3340
```

All 12 groups passed. All ten kit links charged only their listed new products,
with exact subtotals from $13.50 to $98.39. A fresh browser restored the swapped,
owned, skipped, mixed, presentation, and preview-note choices. It charged three
selected products totaling $150.18. The existing-cart case removed two excluded
lines, reducing five charged lines to three.

Corrupt, retired, and incomplete snapshots blocked purchase until explicit
repair. The incomplete snapshot also blocked piece, dialog, and inspector
purchases. Cart response fixtures preserved four unrelated lines and required
price acceptance. These fixtures created no Stripe session.

The run observed 53 allowlisted events across 14 browser journeys, with no
uncaught browser error. Seven invalid preview requests failed before providers;
clip input remained disabled. Unsigned and unsafe saved products were rejected.
A forged proof returned 503 because the test server lacked signing credentials;
this proves a closed failure state, not configured signature validation. The
backend's configured synthetic-record check is recorded separately below.

The [strict release baseline](release-checks.md) then passed at source
`6704bdedbbf1443256f59b4dca4c945b0026dcb7`, build
`s6w_U3F5r-I9tuPR5ITlS`. Its own production server was started and stopped by the
runner. The recorded summary covers all 50 catalogs, 242 components, 556 served
images, 100 model assets, Saved navigation, cart reload/removal/swaps, and 1440px
and 390px layouts. It recorded zero runtime errors, zero unexpected requests, and
ten schema-valid anonymous event requests.

The exact invocation used the CI owner's script at `ed4fee4`, with the integration
checkout as its working directory:

```sh
bun --no-env-file /Users/ohong/.codex/worktrees/halloween-campaign/ci/scripts/verify-release.ts
```

This ran the existing root production build and managed its own temporary server.
The normal package alias is `bun run verify:release`; that alias was not the
literal invocation for this recorded pass.

The application code is unchanged between those two checked commits; only the
release verifier changed. No provider generation, payment session, hosted CI,
deployment, physical-device check, or fulfilled order is implied by these passes.

### Completion kits and readiness

The [kit evidence](kits.md) records ten resolved overlays with new-piece subtotals
from $13.50 to $98.39. Owned basics, tools, supplies, tax, and shipping are excluded.
All 28 purchased product rows have dated primary-source evidence. Existing
catalog prices, stock, and confirmation times remain unchanged.

```sh
bun scripts/verify-kits.ts
bun scripts/verify-kits.ts 2026-12-31
```

Both commands passed 61 checks across ten kits and all 50 bundled catalogs.
Focused types, ESLint, a browser-target library build, and diff checks also passed.
The default check uses October 31, 2027. The second date confirms support for
general events; neither check establishes arrival.

Delivery remains unconfirmed for all ten kits. No source supplies an absolute
earliest-arrival date. Pickup evidence covers one of two Scarecrow purchases,
two of three Roller purchases, and both Queen purchases. Local inventory and
completed pickup were not verified. Queen dress stock is limited to 18w–20w.
Exact cloud/plant variant refreshes were rate limited, so their earlier catalog
facts remain. Assembly durations are editorial estimates, with no timed build.

The [discovery evidence](discovery.md) records:

```sh
bun scripts/verify-discovery-kits.ts http://127.0.0.1:3411 --require-kits
```

Real Chromium checked all 50 card subtotals and ten kit names, links, owned
basics, supplies, pickup scope, and delivery disclosures. The $50/$100/$200
limits returned 4/11/35 looks. Saved, model, and local search controls composed;
empty-price recovery and keyboard access passed. The 390px and 320px layouts
had no horizontal overflow or browser exception. Focused lint, TypeScript, and
diff checks passed. This checks discovery links, not destination cart contents,
semantic-provider behavior, physical devices, or production.

### Saved selections and sourced boards

The [saved-state evidence](../../verification/look-state-2026-11-05.md) records:

```sh
bun scripts/verify-look-state.ts http://localhost:3342
SAVED_LOOK_PERSISTENCE_E2E=1 bun scripts/verify-look-state.ts http://localhost:3342
```

The read-only route pass covered four feature groups. The authorized persistence
pass covered seven. One signed synthetic nonpersonal record survived create,
stable-ID update, and GET while retaining its missing row and stripping sizes.
Only that exact test ID and private request ID were deleted. A separate SELECT
confirmed cleanup. No catalog record or existing saved board changed.

The preview resolver used the saved product title and rejected invented products
or mixed sources before provider work. Saved previews use product names as text
references; they do not fetch merchant images. Live screenshot matching,
successful missing-piece retry, generated preview fidelity, and UI continuity
require separate checks. OpenAI credit exhaustion blocks paid generation.

UI source in `93edd6d` adds exact saved/shared choices, repair states, exact-cart
pruning, kit date constraints, screenshot autosave/reload, saved-only preview,
public saved links, and per-missing-row retry. Private sizes remain in browser
storage. Scoped ESLint and diff checks passed. That lane ran no UI runtime,
production build, or full TypeScript check; the integrated QA above supplies
the recorded runtime evidence.

```sh
bunx eslint components/saved-looks.tsx components/store/costume-experience.tsx components/store/virtual-try-on.tsx components/store/custom-look.tsx components/store/screenshot-costume.tsx components/store/local-product-sizes.ts app/costumes/'[slug]'/page.tsx
```

Follow-up `3f309bd` blocks whole-look and individual-piece purchases while restore
is incomplete or a saved selection needs repair. The shopper must explicitly
choose **Use available picks** before using a repaired selection. Assistant,
photo, save, share, and kit controls also wait for restore readiness.
`bunx eslint components/store/costume-experience.tsx components/store/costume-piece-inspector.tsx`
and `git diff --check` passed. Integrated runtime verified these repair gates.

### Phone camera

The [phone evidence](../../phone-camera.md) distinguishes Metered relay setup,
direct WebRTC, simulated failures, and real hardware. The owner ran these commands
against a local webpack development server with `TRY_ON_TESTING_MODE=1`:

```sh
PHONE_BASE_URL=http://localhost:3036 PHONE_TESTING_MODE=1 PHONE_RELIABILITY_E2E=1 PHONE_EXPECT_RELAY_STATUS=unconfigured node scripts/verify-phone-camera.mjs
PHONE_BASE_URL=http://localhost:3036 PHONE_TESTING_MODE=1 PHONE_DELAY_CANDIDATES=1 PHONE_EXPECT_RELAY_STATUS=unconfigured node scripts/verify-phone-camera.mjs
```

The final server also set `METERED_TURN_APP=phone-e2e-unconfigured` without an
API key. That deliberate incomplete configuration exercised direct fallback:

```sh
PHONE_BASE_URL=http://localhost:3036 PHONE_TESTING_MODE=1 PHONE_RELIABILITY_E2E=1 PHONE_PERMISSION_TIMEOUT_E2E=1 PHONE_EXPECT_RELAY_STATUS=unavailable node scripts/verify-phone-camera.mjs
```

The three runs passed 16, 11, and 17 checks respectively. They covered synthetic
raw streaming, repeated photos, seven-second candidate delay, lost-response
recovery, injected disconnects, failed-lens restoration, a fresh QR reconnect,
permission cancellation, the actual 30-second deadline, and late-track cleanup.
Each results file has an empty error list. Static checks passed.

Follow-up `d460168` preserves the connected source during transient recovery and
corrects the verifier's asynchronous frame wait. Its latest run passed 16 checks
and explicitly observed 11 decoded raw frames. Use that result for a decoded-frame
claim; earlier video dimensions and photos establish a narrower media result.

```sh
PHONE_BASE_URL=http://localhost:3036 PHONE_TESTING_MODE=1 PHONE_RELIABILITY_E2E=1 PHONE_EXPECT_RELAY_STATUS=unavailable node scripts/verify-phone-camera.mjs
```

Local artifacts are under
`/Users/ohong/.codex/visualizations/2026/11/06/halloween-camera-reliability/`.
No Metered or Cloudflare TURN credentials were available. Relay-ready metadata
would prove credentials only; a selected relay candidate is still required.
Forced relay, physical iPhone/Safari, separate networks, cellular handoff, and
phone live inference were not verified.

### Mirror controls

The [mirror evidence](../../mirror-control-evidence.md) records passing static
checks, existing invariants, catalog/reference guards, and these runtime commands:

```sh
MIRROR_BASE_URL=http://localhost:3437 node scripts/verify-mirror-identity.mjs
bun scripts/verify-mirror-catalog.ts http://localhost:3437
MIRROR_COMMAND_FIXTURE=1 MIRROR_BASE_URL=http://localhost:3437 node scripts/verify-mirror-commands.mjs
MIRROR_COMMAND_E2E=1 MIRROR_BASE_URL=http://localhost:3437 node scripts/verify-mirror-commands.mjs
MIRROR_VIDEO_E2E=1 MIRROR_BASE_URL=http://localhost:3437 node scripts/verify-mirror-video-timing.mjs
```

Seven browser fixture checks passed for jacket isolation, preview color, owned
pieces, undo, full-look restoration, stale typed results, and spoken interruption.
Fixtures verify state handling; they do not measure provider latency.

The real command request returned HTTP 429 with exhausted credit. Real text and
voice accuracy and latency remain unverified. One real fal/Lucy synthetic-camera
run measured 524.7 ms to provider open, then 1552.9 ms to the first playable frame.
All captured tracks closed. These are single-run transport observations with no
baseline. They do not prove a changed garment, preserved identity, or improvement.
The change restores no hourly quota.

### Anonymous measurement

The [measurement evidence](measurement.md) records this passing runtime command:

```sh
bun scripts/verify-events.ts http://localhost:3418 /tmp/halloween-telemetry-dev.log
```

The real Chromium helper reached the real endpoint and wrote an ordered event
sequence to stdout. Reload continuity, private-field rejection, custom-record ID
removal, DNT/GPC suppression, origin guards, body bounds, deduplication, and
process-local limits passed. The summary CLI consumed those actual local logs
and returned aggregates without journey IDs. Timing and usage values in that
check were synthetic fixtures, not provider measurements.

No analytics service, log drain, or event database was provisioned. Hosting
retention and export remain unverified. Integrated QA separately verified the
shopping clicks listed above. Actual preview/redirect funnel completion,
production collection, provider usage, and billing remain unverified. Event
limits do not restrict shopping or repeated demonstrations.

### Checkout recovery and freshness

The [checkout evidence](../../checkout-recovery.md) distinguishes controlled
browser failures from real merchant verification. These owner commands passed:

```sh
bun run typecheck
bunx eslint components/store/cart-drawer.tsx lib/checkout/types.ts lib/checkout/catalog-facts.ts app/api/checkout/route.ts lib/checkout/refresh.ts app/api/cron/refresh/route.ts app/api/health/route.ts scripts/verify-checkout-recovery.mjs
node scripts/verify-checkout-recovery.mjs http://127.0.0.1:3415 --merchant
```

The five runtime checks covered 390px and 1440px layouts, focused line recovery,
real catalog replacements, unrelated cart preservation, size persistence, and
explicit price acceptance. Sold-out, unverified, and price-change branches used
controlled checkout responses. They do not establish live merchant stock.

The real checkout API rejected an impossible size for the Cosmic Cowboy fringe
jacket mixed into a Vampire cart. It returned merchant-offered size labels and
source-correct alternatives. No Stripe session could be created by that invalid
input. The configured test key is configuration evidence only; no unpaid session
was created or expired. Authorized refresh writes and production database
mutations were not run. Refresh summaries are not persisted.

### Clip input

The [clip evidence](../../clip-sourcing.md) records the exact guards and probes.
`bun scripts/verify-clip-sourcing.ts` passed 24 real-route checks with zero
provider calls. `bun run typecheck` and focused ESLint passed in the owner
worktree. A two-second local MP4 reached the actual video endpoint:

| Explicit model | Result |
| --- | --- |
| `gemini-3.8-flash` | HTTP 503, busy |
| `gemini-2.5-flash` | HTTP 404, unavailable |
| `gemini-4-argon` | HTTP 429, quota |

A successful model listing did not establish video access. No model is qualified,
and the default flag remains off. A complete real YouTube or upload product board
has not been verified. No new merchant sourcing or external publication occurred
in this lane.
