# Anonymous funnel, latency, and usage measurement

## Purpose and success conditions

Understand which observed journeys reach a costume, preview, cart, and Stripe redirect. Locate slow source and mirror stages. Count measured provider work without inferring a bill.

Success means the real browser can send an ordered journey to the real endpoint. The endpoint must reject private fields, unknown labels, oversized bodies, and cross-origin requests. The summary must expose funnel counts, recovery stages, timing percentiles, and usage units from exported logs.

## Chosen approach

Two options were considered:

- Use the existing host's structured console logs. This requires no new account or database. Delivery and retention remain limited by the host.
- Add a durable event database or analytics platform. This improves queries and deletion controls, but requires new storage, credentials, retention policy, and operations.

This change uses console logs. Shared fixed-field validation avoids adding a browser analytics dependency. No external analytics script runs.

```text
feature action -> trackEvent -> same-origin POST /api/events
                                  |
                           validate and bound
                                  |
                     [telemetry] JSON host log
                                  |
                    exported log -> summary CLI
```

## Browser contract

```ts
import { trackEvent } from "@/lib/telemetry/client";

trackEvent("preview_completion", {
  source: "look", slug: "velvet-vampire", mode: "photo", durationMs: elapsed,
});
```

`trackEvent` returns `void`. It must never block shopping, navigation, camera controls, or errors. Requests use `keepalive` and omit credentials. There are no retries or offline queues.

| Field | Allowed value |
| --- | --- |
| Event name | `view`, `kit`, `filter`, `swap`, `preview_request`, `preview_completion`, `preview_failure`, `cart_add`, `checkout_start`, `checkout_recovery`, `checkout_redirect`, `source_timing`, `provider_usage` |
| `source` | `discovery`, `look`, `screenshot`, `custom`, `mirror`, `cart`, `checkout`, `assistant` |
| `slug` | Published costume slugs from `lib/costumes.ts`, `screenshot-look`, or `custom-look` |
| `durationMs` | Finite number from 0 to 600,000 milliseconds |
| `stage` | `request`, `complete`, `failure`, `cancel`, `rejected`, `parse`, `state_applied`, `provider_connect`, `provider_send`, `first_frame`, `catalog`, `search`, `reasoning`, `image`, `video`, `render`, `retry`, `price_changed`, `prices_accepted`, `sold_out`, `needs_sizes`, `invalid_size`, `unverified`, `error`, `redirect`, `budget` |
| `provider` | `openai`, `anthropic`, `fal`, `decart`, `decisions`, `shopping`, `merchant`, `stripe` |
| `units` | Finite number from 0 to 100,000,000; meaning depends on the fixed event group |
| `mode` | `photo`, `video`, `text`, `voice`, `catalog`, `screenshot`, `custom`, `demo`, `live` |

All properties are optional. Extra fields fail validation. The helper omits unknown slugs. It replaces `custom-look:<uuid>` with `custom-look`, so saved record IDs never enter the event request. Raw unknown slugs sent directly to the endpoint fail validation.

The helper creates a random 128-bit journey ID in `sessionStorage`. A sequence number orders events across reloads. The ID ends with the browser's tab/session storage lifetime. Browser session restore can preserve it. A newly opened tab can inherit a copy of its opener's initial session storage. This ID is an approximate journey, never a unique person. If storage is unavailable, an ID lasts only in page memory. Each journey stops after 1,000 event attempts.

Do Not Track (`1`) or Global Privacy Control (`true`) suppresses browser requests. The server also ignores requests with `DNT: 1` or `Sec-GPC: 1`. Set `TELEMETRY_DISABLED=1` on the server to suppress all event logs.

## Event meanings and units

| Event or stage | Meaning |
| --- | --- |
| `view` | Feature surface mounted; callers prevent repeated mount effects where practical |
| `kit` | Shopper selects a reviewed kit |
| `filter` / `budget` | Fixed budget choice; `units` holds maximum cents, with zero meaning any budget |
| `swap` | Shopper changes an outfit choice |
| `preview_request`, `preview_completion`, `preview_failure` | Browser observed preview lifecycle, including browser elapsed time when provided |
| `cart_add` | Shopper adds an outfit or piece to the cart |
| `checkout_start` | Checkout attempt starts |
| `checkout_recovery` | Fixed blocked/review/acceptance stage; never the error message |
| `checkout_redirect` | Browser is about to navigate to Stripe; this is not payment success |
| `source_timing` | Browser-observed duration for the named source and stage; not inferred provider processing time |
| `provider_usage` / `image` / `photo` | `units` counts completed generated images observed by the caller |

Only measured usage belongs in `provider_usage`. A request failure does not prove a provider billed nothing. There is no billing reconciliation or exact-cost claim. Never mix seconds, image counts, requests, or tokens within one source/stage/provider/mode group. Do not label a provider unless the caller knows which service handled the work.

Mirror timing boundaries must remain distinct:

- `parse`: dispatch to parsed command. Voice starts when the voice service delegates the command.
- `state_applied`: dispatch to the outfit state commit.
- `provider_connect`: initial connection initiation to provider connection open.
- `provider_send`: the state render effect to sending an update to the provider.
- `first_frame`: provider connection open to the first decoded video frame.

Initial connection and subsequent update timings use separate stages because their boundaries differ. No mirror cost or usage units are inferred from these timings.

## Endpoint and log bounds

`POST /api/events` requires a browser Origin matching the direct request Host. Forwarded Host headers are ignored. The route rejects `Sec-Fetch-Site: cross-site` and requires JSON. The server reads at most 2,048 body bytes, including chunked requests without Content-Length.

Accepted events receive a server `receivedAt` timestamp. One console line contains `[telemetry] ` followed by the validated event JSON. Request headers, URLs, device details, raw errors, photos, prompts, search text, addresses, IPs, and phone pairing tokens are never added to these application event logs.

| HTTP status | Meaning |
| --- | --- |
| 204 | Accepted, duplicate, disabled, or privacy signal honored; body is empty |
| 400 | Invalid JSON, event fields, or event labels |
| 403 | Missing or different browser Origin, or cross-site request |
| 413 | Body exceeds 2,048 bytes |
| 415 | Content type is not JSON |
| 429 | Process-local event bound reached; Retry-After is 60 seconds |

Each process accepts at most 60 events per journey and 5,000 events overall in a 60-second window. Duplicate journey/sequence pairs do not create another log within that window. Limits and duplicate detection reset after the window or a cold start. They are not durable abuse prevention across instances. An HTTP client can forge an Origin header. Treat browser events as untrusted observations.

## Retention and privacy limits

Event storage is the existing hosting log destination. No application database, analytics account, log drain, or retention setting is provisioned. The host's current plan and configuration decide retention and export availability; those settings were not verified here. The application has no separate deletion scheduler or individual-event deletion API. In-memory rate-limit state lasts at most one minute of an active process.

Hosting access logs can separately retain IP addresses and request metadata under the host's policies. Provider input and retention behavior remain separate from anonymous measurement. Do not describe this feature as a guarantee that hosting or providers collect no personal data.

## Export and report

1. Export available runtime logs from the existing host.
2. Keep the export in a restricted local location.
3. Run the summary command against that file.

```sh
bun scripts/summarize-events.ts /path/to/events.log
bun scripts/summarize-events.ts /path/to/events.log --since=2026-11-05T00:00:00Z
```

The command accepts raw event JSONL, prefixed console lines, or JSONL records whose `message` contains a prefixed line. It ignores other logs without printing their content. It deduplicates journey/sequence pairs. Its output contains aggregates, with no journey IDs.

Reports show observed event counts, checkout recovery counts, ordered discovery-to-redirect and preview-to-cart funnels, timing sample counts/p50/p95/max, and measured usage units grouped by event/source/stage/provider/mode. The percentile uses the nearest-rank method. The report does not equate a Stripe redirect with an order or a journey with a person. It does not backfill prior visits.

## Verification performed

- `bunx next typegen` and full `bunx tsc --noEmit --incremental false`: passed.
- Focused ESLint for the telemetry helpers, endpoint, and two scripts: passed.
- Real Chromium helper -> running Next route -> server stdout: passed with an ordered view/kit/swap/preview/cart/checkout/recovery/redirect sequence.
- Reload continuity, custom-record ID removal, browser DNT/GPC suppression, and server privacy signals: passed.
- Cross-origin, wrong content type, malformed JSON, private extra fields, unknown slug, timing bounds, declared and streamed body limits, duplicates, and per-journey rate limits: passed.
- Summary CLI consumed actual local runtime logs and produced aggregate journey/funnel counts. Timing and usage values in this verification are synthetic fixtures, not provider measurements.
- No provider calls, payment sessions, production collection, hosting export, hosting retention, cross-instance limit, or complete UI funnel was verified by this lane. Feature owners instrument their surfaces; final integration must verify those clicks.

The runtime command was `bun scripts/verify-events.ts http://localhost:3418 /tmp/halloween-telemetry-dev.log`. The local server used webpack because this worktree's shared dependencies are symlinked outside Turbopack's root. No bundler configuration changed. No full production build ran in this lane.
