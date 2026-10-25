# Live Costume Mirror

The costume page opens a fullscreen fitting room. Shoppers can select exact
catalog products, keep pieces, mark their own clothing, adjust a spending budget,
undo edits, and save/restore outfit snapshots. Applying the look updates the page's
shopping selections without initiating a purchase. Existing photo try-on remains
available for devices or sessions without live video.

## Connections and configuration

- `OPENAI_API_KEY`: reuse the application's server-side key. It needs access to
  GPT-Live, Decisions, and Responses for budget extraction.
- `OPENAI_LIVE_MODEL`: defaults to `gpt-live-1`.
- `OPENAI_DECISION_MODEL`: defaults to `gpt-6-luna`.
- `DECART_API_KEY`: server-only Decart key. The app issues short-lived browser
  tokens restricted to the current origin and `lucy-vton-3.6`.

Voice uses OpenAI's Live WebRTC session contract, not the older Realtime API.
Native Decisions delegation selects bounded actions against catalog product IDs.
Transcript triggers can identify the currently discussed piece without changing
the outfit. Arbitrary budget amounts are extracted through Responses. Commands
are validated against the catalog before they change local outfit state.

The camera is streamed to Decart for transformed video. Microphone audio goes to
OpenAI; it is not sent to Decart. The server builds a reference board from the
selected catalog garments and submits the entire intended outfit with each edit.
This avoids treating independent prompts as persistent garment layers. Generated
video remains an approximate appearance preview, not a measurement or fit promise.

Closing the mirror stops the sessions and device tracks. Freezing a preview stops
video generation; voice can continue for shopping. A Decart token constrains active
video sessions to 180 seconds. Token expiry alone would not end an existing
connection. The application also performs client-side teardown.

## Cost and public rollout

At the rates researched on October 24, 2026, GPT-Live is $0.05/minute and standard
Decart VTON is $0.02/second. Three minutes of simultaneous use is approximately
$3.75 before Decisions, Responses and hosting. Verify provider pricing before
launch. Start video explicitly and freeze when shoppers are ready to compare.

API routes have local request limits. These are per-process controls, not a
distributed quota. Before a broad public rollout, configure shared quotas or
hosting firewall limits and provider spending limits. Avoid silently enabling
unbounded paid video on page load.

## Demo and verification checklist

1. Configure the keys in the target environment; use HTTPS or localhost.
2. Open Cosmic Cowboy, enter the mirror, and start camera and voice. Frame one
   person head-to-toe with even lighting.
3. Say “Keep the hat. Choose another jacket.” Confirm the product card, garment
   preview and subtotal agree, and the hat and person's identity remain stable.
4. Say “I own the boots” and confirm the boots no longer add to the subtotal.
5. Set a budget and request a cheaper look. Kept pieces must remain selected;
   an impossible budget must not be reported as satisfied.
6. Interrupt and correct a selection. Confirm old decisions cannot overwrite the
   newer state. Undo, save, change a piece, then restore the saved look.
7. Freeze the preview, resume, close the mirror, then reopen. Verify camera/mic
   indicators turn off on close and no old sessions continue generating.
8. Repeat on mobile, denied permissions, offline/reconnect, fast movements,
   occluded arms and dim light. Inspect actual SKU details, not just the theme.

Measure speech-to-selection separately from selection-to-visible-garment latency.
Do not quote the decision API's latency as the full video transformation latency.
Successful application tests do not establish garment fidelity or provider access;
those require a real camera session with configured credentials.

## Implementation verification

Verified in the implementation workspace:

- Production build, TypeScript and ESLint checks.
- 15 state, catalog-reference and native-decision tests, including locked pieces,
  owned-item totals, impossible budgets, invalid products, duplicate selections,
  refusals and atomic undo.
- Chromium at desktop and mobile sizes: piece changes, budget optimization,
  save/restore, parent selection updates, owned-item cart removal, keyboard focus
  trapping and Escape restoration, without horizontal overflow or page errors.
- Real local reference-board generation; video consent validation, same-origin
  rejection and clear missing-credential responses.
- Microphone failure cleanup with Chromium's synthetic input device and the actual
  missing-key endpoint response. This is a lifecycle test, not a provider demo.

OpenAI and Decart live sessions were not executed. The existing deployment's
OpenAI key was inaccessible from this workspace, and the user will configure
Decart before live testing. No successful transformed video or latency claim is
implied by these checks.

## Official contracts

- https://developers.openai.com/api/docs/guides/voice-webrtc?api=live
- https://developers.openai.com/api/docs/guides/decisions-voice
- https://docs.platform.decart.ai/models/realtime/virtual-try-on
- https://docs.platform.decart.ai/getting-started/client-tokens
- https://docs.platform.decart.ai/getting-started/pricing
