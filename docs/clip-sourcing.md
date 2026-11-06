# Clip to costume

Clip input stays disabled until a deployment explicitly sets `CLIP_COSTUME_ENABLED=1` and `GEMINI_CLIP_MODEL`.
There is no default model. `GEMINI_API_KEY`, `OPENAI_API_KEY`, and the existing sourcing key must also be configured.
`GET /api/clip-costume` exposes only an enabled boolean. The UI hides clip input when it is false.
Keep the flag off until an actual video request succeeds with the chosen model and account.

The existing screenshot route keeps its OpenCV segmentation, labeling, matching, and traces.
The clip route reads the video, then streams the same look and product events to the existing results board.
We considered extracting both routes into one stream helper. A separate clip route preserves the newer screenshot behavior and limits the integration surface.

Uploaded MP4, WebM, and MOV files have a 4 MiB cap. Multipart bodies have a separate 4,500,000 byte cap.
The browser captures a selected reference frame, capped at 200 KiB. The server checks container signatures and re-encodes the image.
It reserves at most four concurrent requests, allows 90 seconds for video reading, then gives sourcing 30 seconds.
Client cancellation stops downstream work. Results already received survive timeouts and later errors.

YouTube links use an allowlist and an 11-character video ID. Only a canonical URL reaches Gemini.
This server never downloads a pasted URL, a video, or its thumbnail.
YouTube results remain shop links because a thumbnail cannot establish what the selected outfit looks like.
Upload a clip with a selected frame to compare merchant photos and create priced cart pieces.

Provider quota, access, and unavailable-model errors have separate user messages. Provider bodies, media, and credentials are not logged.
Signing proofs use the shared saved-look helper for priced pieces.

## Verification

Run input checks without provider work:

```sh
bun scripts/verify-clip-sourcing.ts
bun run typecheck
bunx eslint app/api/clip-costume/route.ts lib/sourcing/clip-vision.ts components/store/clip-input.tsx scripts/verify-clip-sourcing.ts
```

Run video analysis only after choosing a model explicitly:

```sh
GEMINI_CLIP_MODEL=<verified-model> bun scripts/verify-clip-sourcing.ts --provider --upload /absolute/path/to/short.mp4
```

The optional `--youtube` check accepts a public YouTube URL instead. Neither provider check performs shop sourcing.
For full stream verification, enable a local deployment and submit a valid clip in the browser. Confirm candidates arrive before `done`, cancellation stops work, and quota errors remain clear.
That final verification can invoke the existing paid sourcing providers and requires authorization under the current project rules.

## Current provider evidence

On 2026-11-05, the inherited environment supplied `GEMINI_API_KEY`. The original local environment file did not contain that key name.
The account's model listing returned HTTP 200 and included the tested names. This did not establish generation access.
A two-second MP4 derived from the existing local assembly film produced:

| Explicit model | Actual video result |
| --- | --- |
| `gemini-3.8-flash` | HTTP 503, busy |
| `gemini-2.5-flash` | HTTP 404, unavailable |
| `gemini-4-argon` | HTTP 429, quota |

No model is qualified for enabling the feature. No subscription or account setting changed. No live merchant sourcing was run.

Official references checked on the same date: [video inputs](https://ai.google.dev/gemini-api/docs/video-understanding?hl=en), [generateContent REST](https://ai.google.dev/api/generate-content?hl=en), and [structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output).
The retained REST configuration reached model availability and quota checks. A successful video response remains unverified.
