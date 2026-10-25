# Live Costume Mirror

Open any costume page and select **Try it on live**. Allow camera and microphone
processing, then select **Start my mirror**. The main view receives generated
video; the small inset shows the original camera.

Swipe up/down on the mirror, use the arrow buttons, or choose a named costume to
switch among all 25 looks. The existing video connection stays open. Change a
piece with its selector, type a request, or speak naturally:

- “Keep the hat. Choose the cheapest jacket.”
- “Try Velvet Vampire.”
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
Catalog product cutouts ── reference board + prompt ──┤
                                                    ▼
Camera ──WebRTC──> Decart Lucy 2.5 ──WebRTC──> live preview
                        ▲
                   fal signaling
```

- `FAL_KEY`: server-only fal key. The app uses
  `decart/lucy-2-5/realtime`. A direct Decart key is no longer required.
- `OPENAI_API_KEY`: server-only OpenAI key with GPT-Live and Decisions access.
- `OPENAI_LIVE_MODEL`: defaults to `gpt-live-1`, verified available on the account.
- `OPENAI_DECISION_MODEL`: defaults to `gpt-6-luna`.

The browser receives a 60-second fal token scoped to `decart/lucy-2-5`.
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

The server composites the complete desired outfit from local catalog assets.
Boards are at least 512×512, including single-piece selections. Product files are
included in the deployed reference function. Every edit sends the full intended
outfit, preserving owned clothing instead of treating edits as permanent layers.

## Lifetime and rendering limits

Camera capture starts only after consent and an explicit Start action. Closing,
leaving, or hiding the page releases media. Freeze disconnects video and releases
the camera while voice remains available; Resume creates a new video connection.
Failed connections require an explicit retry. Each UI session stops after three
minutes. Token expiry alone does not terminate a running fal session; the
three-minute limit is client-side, not a provider-enforced spending cap.

The interface marks video live only after the video element begins playing.
A control send confirms only that an outfit request was sent. The fal extension
does not expose a garment-render acknowledgement. Neither an SDK send nor a
returned frame proves that the latest garment is visibly correct.

Generated video is an approximate appearance preview. Fine garment details,
identity preservation, occlusion, motion, and real-world fit require visual
assessment with a person. This implementation does not promise sub-second
speech-to-visible-garment latency.

Fal lists Lucy 2.5 at $0.04 per processed video second: approximately $2.40 per
minute, or $7.20 for three minutes, plus voice and Decisions usage. Verify current
provider pricing before changing session limits. The application has per-process
request limits; deployment-wide quotas and provider spending controls remain
separate operations.

## Reproduce the real-provider test

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

The camera fixture is a generated catalog mannequin. The microphone is synthetic
speech. The app, route handlers, reference generation, fal video, OpenAI voice,
and Decisions calls are real. This test does not use a sleeping user's devices.

The test checks consent, cross-origin rejection, real decoded video and received
voice audio, spoken piece changes, unrelated-piece preservation, live catalog
replacement, owned pieces, downloads, freeze/resume, complete media cleanup,
shopping-state restoration, mobile overflow, swipe navigation, and Escape.

On October 25, 2026, the complete local real-provider test passed. The first
decoded frame arrived 3.3 seconds after Start in that run. This measures initial
connection time, not speech-to-visible-garment latency. Lint, TypeScript, all 15
existing mirror checks, and the production build also passed. Physical webcam
motion, iPhone Safari, and garment fidelity on a person remain unverified.

## Official contracts

- https://fal.ai/models/decart/lucy-2-5/realtime/api
- https://fal.ai/lucy-2.5
- https://github.com/fal-ai/fal-js/blob/main/libs/client/src/realtime/lucy.ts
- https://docs.platform.decart.ai/models/realtime/virtual-try-on
- https://github.com/DecartAI/tryon-examples
- https://developers.openai.com/api/docs/guides/voice-webrtc?api=live
- https://developers.openai.com/api/docs/guides/decisions-voice
