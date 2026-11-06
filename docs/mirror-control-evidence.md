# Selective mirror controls and latency evidence

Validated locally against the campaign mirror worktree on 2026-11-06. These
results do not establish deployed behavior or physical-phone behavior.

## Design choice

The old branch contains useful latency fixes, but its partial-apply path commits
an action before later model calls finish. It then waits 80 ms and slices merged
actions by their earlier count. That can create two Undo steps and couples
correctness to render timing.

This change keeps each request atomic. It runs independent preview, catalog,
and budget calls together. Direct Decisions actions need no follow-up request.
Full-look switches and Undo skip lookups against the old outfit. A full-look
switch applies its requested budget to the new look in the same history entry.

Catalog discovery uses two bounded Decisions stages and a code-filtered
shortlist instead of sending every product description to a reasoning call.
Stored color/material/style tags rank candidates; they do not discard untagged
products. Current category, scope, price, product IDs, and stock determine
allowed choices. All 470 current products have stored tags; 726 catalog references narrow to at
most 40 new candidates plus up to eight prior results. Semantic accuracy still
needs a funded-provider check.

Merchant reference images no longer reach Lucy. The reference route returns a
bounded garment prompt. The prompt asks the provider to preserve the person.
This removes another person's catalog photo from the identity input; it does
not prove face fidelity.

New speech aborts the previous delegated request. Newer manual state also
invalidates older typed and spoken responses. Owned pieces clear earlier
preview overrides. Product optimization clears stale preview overrides only
for changed products. Undo restores the complete preceding outfit snapshot.

## Timing definitions

The browser emits anonymous `mirror-timing` events and matching `source_timing`
events. It sends no command text, transcript, photo, product IDs, or phone token.

| Stage | Start | End | Meaning |
| --- | --- | --- | --- |
| `parse`, text | Command dispatch | Parsed command response | Includes network and model work |
| `parse`, voice | Delegation created | All required decisions and follow-ups complete | Excludes earlier speech recognition |
| `state_applied` | Same command/delegation start | Outfit state committed | Includes parsing; no pixel claim |
| `provider_connect` | Start mirror | Provider open call | Includes camera, reference, and token work |
| `provider_send` | New outfit observed by render effect | Control send returns | Includes debounce and reference route |
| `first_frame` | Provider connection opened | First playable remote video frame | Connection transport only |

Connection and outfit-send durations use separate stages and start points.
The provider has no garment-render
acknowledgement. No timing here says the requested garment appeared. A decoded
frame after a control send would still not establish garment correctness.

## Commands and results

No full build ran. The focused static checks passed:

```sh
npx --no-install eslint app/api/live-mirror lib/live-mirror components/store/live-mirror.tsx scripts/verify-mirror-commands.mjs scripts/verify-mirror-video-timing.mjs scripts/verify-mirror-recovery.mjs
npx --no-install tsc --noEmit --incremental false
git diff --check
bun test lib/live-mirror/state.test.ts lib/live-mirror/voice-decisions.test.ts lib/live-mirror/video-outfit.test.ts
```

The existing invariant checks passed: 15 tests, zero failures.

```sh
MIRROR_BASE_URL=http://localhost:3437 node scripts/verify-mirror-identity.mjs
bun scripts/verify-mirror-catalog.ts http://localhost:3437
```

The database returned all 50 looks, 242 pieces, and 470 distinct products.
All 152 reference requests omitted an image and retained bounded preservation
prompts. Foreign origins, forged outfit IDs, and forged prior search references
were rejected. These checks did not call Lucy or a text model.

```sh
MIRROR_COMMAND_FIXTURE=1 MIRROR_BASE_URL=http://localhost:3437 node scripts/verify-mirror-commands.mjs
```

Seven browser fixture checks passed. They covered cheaper jacket isolation,
preview color without product changes, owned pieces, complete Undo, full-look
switch and restoration, delayed typed response rejection, and interruption of
an older spoken delegation. Fixtures intercept requests only in the check
script. Product code has no fake-provider path. Fixture timings describe local
state plumbing and must not be used as provider latency evidence.

```sh
MIRROR_COMMAND_E2E=1 MIRROR_BASE_URL=http://localhost:3437 node scripts/verify-mirror-commands.mjs
```

The first real Decisions request returned HTTP 429. A bounded diagnostic request
confirmed `insufficient_quota` / `credit_balance_exhausted`. Real text and voice
command accuracy and latency remain unverified. The app now reports the credit
problem separately from temporary rate limiting. No further OpenAI calls ran.

```sh
MIRROR_VIDEO_E2E=1 MIRROR_BASE_URL=http://localhost:3437 node scripts/verify-mirror-video-timing.mjs
```

The real fal/Decart transport returned playable video from Chromium's synthetic
test-pattern camera. The single local run recorded 524.7 ms from mirror start
to provider open, then 1552.9 ms from open to the first playable frame. A second
run recorded 1086.8 ms to open, 1728.7 ms from open to first frame, and 519.3 ms
from changed outfit state to the control send. The check
closed all captured tracks. It did not start OpenAI voice or use personal media.
These are two observations, with no baseline or improvement claim.
Garment accuracy, likeness, and physical-device behavior remain unverified.

Evidence: `mirror-video-timing-rgJ7bQ/timing.json` and
`mirror-video-timing-FkiOzI/timing.json` in the local test temporary directory.
Those captures used the earlier name `provider_send` for both initial and
update events. The final code names initial events `provider_connect`. Final fixture evidence: `mirror-commands-99I7yg/commands.json`.
The reviewed measurements are retained in
[`mirror-controls-2026-11-06.json`](./evidence/mirror-controls-2026-11-06.json).

## Rehearsal limits

The change retains unlimited demo behavior from `TRY_ON_TESTING_MODE=1` and
retains relaxed photo handling. It adds no hourly quota. Provider retries are
bounded to three attempts, cancel on consent withdrawal or close, and stop
immediately for billing, authentication, or input failures. The paired phone
stream remains separate from generated-video attempts.
