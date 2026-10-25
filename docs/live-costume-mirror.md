# Live Costume Mirror

Open any costume page and select **Try it on live**. Allow camera and microphone
processing, then select **Start my mirror**. The main view receives generated
video; the small inset shows the original camera.

The video fills the main area. GPT Live and its transcript use a smaller sidebar.
On phones, the video comes first and the conversation follows below it. The room
uses the same white, gray, type, and button styles as the storefront. Manual
selectors remain available under **Costumes & pieces**.

Speak naturally to change the look without opening a selector. Swipe or use the
arrow buttons as another option. The existing video connection stays open:

- “Keep the hat. Choose the cheapest jacket.”
- “Change my Halloween costume for me.” / “Surprise me.”
- “Try Velvet Vampire.”
- “Make the cape bright blue.”
- “Make the jacket leather, keeping its current color.”
- “Restore the cape’s original color.”
- “Choose the cheapest cape.”
- “I already own the boots.”
- “Undo that.” / “Freeze the preview.” / “Resume.” / “Save this look.”

Piece cards show the selected product, merchant, and price. Owned and skipped
pieces do not contribute to the shopping subtotal. **Shop this look** carries
selected products and owned/skipped choices to the matching costume page.
Selecting a product does not buy it or confirm its size or availability.

## Connections

```text
Microphone ──WebRTC──> GPT-Live ──native delegation──> Decisions
                             <── confirmed catalog selection
                                                    │
Catalog piece names ── clothing-only prompt ─────────┤
                                                    ▼
Camera ──WebRTC──> Decart Lucy VTON ──WebRTC─> live preview
                        ▲
                   fal signaling
```

- `FAL_KEY`: server-only fal key. The app uses
  `decart/lucy2-vton/realtime`, the dedicated try-on endpoint. A direct Decart key is not required.
- `OPENAI_API_KEY`: server-only OpenAI key with GPT-Live and Decisions access.
- `OPENAI_LIVE_MODEL`: defaults to `gpt-live-1`, verified available on the account.
- `OPENAI_DECISION_MODEL`: defaults to `gpt-6-luna`.

The browser receives a 60-second fal token scoped to `decart/lucy2-vton`.
The permanent key stays on the server. Camera video goes directly to Decart;
fal relays the connection and outfit controls. Microphone audio goes to OpenAI.
The app does not persist camera frames or recordings. Saved previews download
from browser memory only when requested.

`@fal-ai/client` is pinned to `1.11.0-alpha.3`: its official Lucy WebRTC extension
owns signaling, ICE candidate ordering, and cancellation. The stable `1.10.1`
release only offers the lower-level realtime WebSocket client. Pinning the
extension avoids maintaining a second WebRTC signaling implementation here.

## Catalog and voice behavior

The existing catalog already supplies product IDs, descriptions, prices,
merchants, categories, and reviewed local cutouts. Decisions receives that text;
it does not receive camera frames. A single multi-question decision selects
bounded actions instead of two sequential classification requests.

Per-piece questions select actual product IDs. Whole-outfit optimization needs
an explicit whole-outfit scope, so “cheapest jacket” does not replace the hat,
trousers, boots, or scarf. A keep request prevents a simultaneous replacement.

Full-look switching loads the new catalog and replaces the voice session's
questions and transcript triggers. The app waits for `session.updated` before
sending the new outfit snapshot. Old pending decisions are discarded. The voice
and video connections remain open across a look change.

Color, material, and style requests use a bounded preview-edit action. Decisions
recognizes the intent; a server-side Responses call extracts only current piece
IDs and appearance properties. These edits are part of outfit history, respect
kept pieces, and leave product IDs and prices unchanged. The reference request
includes all appearance overrides, and Lucy's prompt gives those overrides
priority over the default clothing description. Selecting another merchant option clears the
appearance override for that piece. Undo restores the previous appearance.

An unspecified request to change costumes advances to a different catalog look.
GPT Live receives the current costume, selected pieces, appearance overrides,
and preview status (live, updating, frozen, or failed). This links the conversation
to the app's state; GPT Live does not inspect the camera's pixels. Video and
microphone data continue to use their separate providers.

The server describes the complete desired outfit using catalog piece names.
The reference endpoint returns `image: null`; the browser explicitly sends
`reference_image_url: null` at startup and on every update. Merchant photos can
include models' faces, hair and makeup. Sending those photos through Lucy's
shared character-swap/try-on reference input can introduce a competing identity.
Text-only editing avoids that input, at the cost of exact garment detail.
Garment images need a separate garment-only review before they can return.
Every edit sends the full intended outfit, preserving owned clothing.

The app uses the dedicated Lucy VTON endpoint instead of Lucy 2.5 general
video editing. Face and likeness preservation takes priority over clothing edits. Prompts
prohibit facial changes, makeup, beauty filters and body reshaping. Prompt
expansion stays disabled. The voice stylist must acknowledge reported face
changes and cannot claim the pixels are unchanged or fixed. These controls
reduce identity-transfer risk; they do not guarantee pixel-level preservation
in generated video. Real-person visual verification remains required.

## Lifetime and rendering limits

Camera capture starts only after consent and an explicit Start action. Closing,
leaving, or hiding the page releases media. Freeze disconnects video and releases
the camera while voice remains available; Resume creates a new video connection.
Failed connections require an explicit retry. Outside testing mode, each UI
session stops after three minutes. Token expiry alone does not terminate a running fal session; the
three-minute limit is client-side, not a provider-enforced spending cap.

The interface marks video live only after the video element begins playing.
A control send confirms only that an outfit request was sent. The fal extension
does not expose a garment-render acknowledgement. Neither an SDK send nor a
returned frame proves that the latest garment is visibly correct.

Generated video is an approximate appearance preview. Fine garment details,
identity preservation, occlusion, motion, and real-world fit require visual
assessment with a person. This implementation does not promise sub-second
speech-to-visible-garment latency.

Live video, voice and Decisions consume provider credits. Verify current
pricing for the dedicated VTON endpoint before changing session duration. Repeated live sessions,
resumes, and voice commands have no hourly app or project firewall quota.
Testing mode disables the app session cutoff. Outside testing mode, each video
connection ends after three minutes and restarts explicitly.
See [current session behavior](./mirror-session-limits.md).

## Reproduce the real-provider test

Check the actual reference routes without paid inference or camera access:

```sh
MIRROR_BASE_URL=http://localhost:3028 node scripts/verify-mirror-identity.mjs
```

This checks every published look at three available product tiers, plus color
and owned-piece changes. It verifies that merchant images are absent and face
preservation instructions remain present. It does not measure generated likeness.

```sh
bun install
bun run dev --port 3025
# In another terminal; this spends fal/OpenAI credits:
LIVE_MIRROR_E2E=1 node scripts/verify-live-mirror.mjs
```

The test uses Playwright Chromium, `ffmpeg`, and macOS `say`. Install Chromium with
`bunx playwright install chromium` if needed. On other hosts supply
`MIRROR_TEST_VIDEO` (Y4M) and `MIRROR_TEST_AUDIO` (48 kHz mono WAV, jacket request at
10 seconds and cape request at 30 seconds). `MIRROR_BASE_URL` chooses the target;
`MIRROR_EVIDENCE_DIR` chooses an existing output folder. The default evidence
folder is temporary and contains screenshots, a saved preview, and JSON results.
For a protected deployment, `MIRROR_ACCESS_URL` can bootstrap an authorized
Vercel share link. It is not written to the evidence or used to bypass quotas.

The camera fixture is a generated catalog mannequin. The microphone is synthetic
speech. The app, route handlers, reference generation, fal video, OpenAI voice,
and Decisions calls are real. This test does not use a sleeping user's devices.

For voice-only interaction coverage, run:

```sh
LIVE_MIRROR_E2E=1 MIRROR_BASE_URL=http://localhost:3025 node scripts/verify-voice-mirror.mjs
```

This uses synthetic speech and a catalog mannequin with real GPT Live,
Decisions, Responses, and Lucy calls. It covers spoken whole-costume switching,
an arbitrary cape color, a single-piece swap, and an unspecified costume change
without selectors. It also checks screen-state updates, stable connections,
media cleanup, multiple color edits, material changes, undo, restoration, and
mobile layout. No personal camera or microphone is opened.

On October 25, 2026, this voice-control test passed against the local app. At a
1440-pixel viewport, the main video area measured 1000 pixels wide and the
sidebar measured 320 pixels. The test received real voice audio and 768 decoded
video frames, and its captured preview visibly shows a blue cape. Whole-look
and piece changes retained the existing connections. Typed commands also passed
multiple-color edits, material changes that retain color, undo, and color reset.
An earlier attempt encountered a video transport failure; an explicit retry
connected successfully. Provider availability and generated garment fidelity
remain variable. Physical webcam use and iPhone Safari remain unverified.

The earlier test checks consent, cross-origin rejection, real decoded video and received
voice audio, spoken piece changes, unrelated-piece preservation, live catalog
replacement, owned pieces, downloads, freeze/resume, complete media cleanup,
shopping-state restoration, mobile overflow, swipe navigation, and Escape.

On October 25, 2026, the complete local real-provider test passed. The first
decoded frame arrived 3.3 seconds after Start in that run. This measures initial
connection time, not speech-to-visible-garment latency. Lint, TypeScript, all 15
existing mirror checks, and the production build also passed. Physical webcam
motion, iPhone Safari, and garment fidelity on a person remain unverified.

## Official contracts

- https://fal.ai/models/decart/lucy2-vton/realtime/api
- https://fal.ai/models/decart/lucy-2-5/realtime/api
- https://fal.ai/lucy-2.5
- https://github.com/fal-ai/fal-js/blob/main/libs/client/src/realtime/lucy.ts
- https://docs.platform.decart.ai/models/realtime/virtual-try-on
- https://github.com/DecartAI/tryon-examples
- https://developers.openai.com/api/docs/guides/voice-webrtc?api=live
- https://developers.openai.com/api/docs/guides/decisions-voice
