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
Camera ──WebRTC──> Decart Lucy 2.5 ──WebRTC─> live preview
                        ▲
                   fal signaling
```

- `FAL_KEY`: server-only fal key. The app uses
  `decart/lucy-2-5/realtime`. A direct Decart key is not required.
- `OPENAI_API_KEY`: server-only OpenAI key with GPT-Live and Decisions access.
- `OPENAI_LIVE_MODEL`: defaults to `gpt-live-1`, verified available on the account.
- `OPENAI_DECISION_MODEL`: defaults to `gpt-6-luna`.

The browser receives a 60-second fal token scoped to `decart/lucy-2-5`.
The permanent key stays on the server. Camera video goes directly to Decart;
fal relays the connection and outfit controls. Microphone audio goes to OpenAI.
The app does not persist camera frames or recordings. Appearance questions
send captured preview frames to OpenAI; likeness questions also send the paired
original camera frame. These requests use the existing processing consent. Saved previews download
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
to the app's state; GPT Live receives fresh visual observations only when the shopper requests
appearance feedback; control state alone is not visual evidence. Video and
microphone data continue to use their separate providers.

The server builds the earlier product-reference board from local catalog assets.
Each cell uses a product cutout when available, otherwise its catalog image.
The browser sends the board as `reference_image_url` to
`decart/lucy-2-5/realtime`, with prompt expansion disabled. The prompt asks Lucy
to substitute those garments and preserve the camera person's face, hair,
body shape, skin tone, pose, background and lighting. Owned pieces remain unchanged.
Color and style overrides still apply to garments.

This restores the rendering behavior from before commit `dc2349d`, while keeping
camera switching and on-request GPT Live visual feedback. It does not revert
photo generation or catalog changes. The separate fal Lucy 2.1 VTON endpoint
is not used.

A reference board can contain a merchant model when no cutout exists. The prompt
instructs Lucy to treat references as garments, never identity references, but
this is not an enforced face lock. Do not promise unchanged faces based on a
successful connection or prompt check. Visual comparisons with the original
camera remain available through GPT Live.

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

- https://fal.ai/models/decart/lucy-2-5/realtime/api
- https://fal.ai/lucy-2.5
- https://github.com/fal-ai/fal-js/blob/main/libs/client/src/realtime/lucy.ts
- https://docs.platform.decart.ai/models/realtime/virtual-try-on
- https://github.com/DecartAI/tryon-examples
- https://developers.openai.com/api/docs/guides/voice-webrtc?api=live
- https://developers.openai.com/api/docs/guides/decisions-voice


## Visual feedback on request

Ask **“How do I look?”** to assess the currently displayed costume preview.
Ask **“Has the preview changed my face?”** or **“Compare my likeness with the
original camera”** to describe visible rendering differences between the
preview and the original. These questions do not change outfit selections,
product IDs, appearance overrides, or the shopping cart.

GPT Live remains an audio/text model. A new Decisions choice routes explicit
visual questions to the browser. The browser captures the display only after
consent and that request, then calls `/api/live-mirror/feedback`. Styling sends
one image; likeness sends two. A standalone Responses call with
`gpt-6-luna` (or `OPENAI_MIRROR_VISION_MODEL`) returns concise observations.
Those observations return to GPT Live through the existing delegated-result
channel, and GPT Live speaks the answer. Typed questions show the same feedback
in the conversation.

```text
Appearance question → Decisions → browser snapshot → Responses vision
                                                   │
GPT Live spoken answer ← fresh visual observations ─┘
```

There is no periodic visual upload or continuous video feed to OpenAI. Capture
uses JPEG at a maximum 960-pixel edge. The server bounds the request body,
requires same-origin JSON and explicit processing consent, rejects remote image
URLs, validates decoded image dimensions, strips metadata, and uses
`store: false`. It never writes images to storage. Close, navigation, or session
cancellation aborts outstanding work. Changed outfits, camera sources, frozen
frames and superseded spoken questions invalidate older assessments.

Freezing retains a paired original in browser memory before stopping live
video. A later frozen likeness question compares that original with the frozen
preview, rather than taking an unrelated later camera frame. The model labels
frozen feedback and notes that it may predate the latest garment choices.
If either required image is missing, the app asks the shopper to resume the
camera. Photo-mode voice controls do not have access to a live mirror image;
they explain that the live mirror must be opened for this feature.

Feedback describes visible clothing and rendering differences. It does not
identify or authenticate a person, promise pixel-identical faces or physical
fit, or infer hidden details. Pose, expression and lighting differences are not
proof of identity changes. Small, blurred or covered faces limit comparison.

Run the real-provider check with synthetic camera and speech input:

```sh
LIVE_MIRROR_E2E=1 MIRROR_BASE_URL=http://localhost:3028 node scripts/verify-mirror-feedback.mjs
```

This checks the actual browser, Lucy, GPT Live, Decisions and vision route.
It checks consent, image validation, absence of background uploads, style-only
image selection, frozen paired-original comparison, spoken and typed results,
unchanged outfit choices, and media cleanup. No personal devices are opened.

Official contracts:
- https://developers.openai.com/api/docs/models/gpt-live-1
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/guides/live-delegation
