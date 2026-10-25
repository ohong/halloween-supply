# Phone camera for photo and live try-on

One QR connection supplies the desktop's raw preview, photos from the original camera feed, Lucy video, and optional GPT Live microphone input.

```text
Phone camera ── WebRTC video ────────> Desktop preview ── fal/Lucy ──> Live costume
             └─ photo data channel ─> Photo try-on ───── OpenAI ────> Still preview
Phone mic (optional) ── WebRTC ──────> GPT Live + Decisions ────────> Outfit choices

Vercel + Turso: temporary connection descriptions only; no camera images or audio
Optional TURN relay: encrypted forwarding if direct connectivity fails
```

The alternative was to run Lucy on the phone and forward its output. Keeping inference connections on the desktop preserves the existing outfit controls and lets photo and live modes share one phone connection. It adds a second video connection and depends on WebRTC connectivity between the devices. Photos come from the phone camera rather than the lower-resolution received video. They are resized to at most 1,600 pixels before transfer over the ordered data channel.

## User flow

1. Open a costume's **Try it on** tab and choose **Use phone camera**.
2. Scan the code. On the phone, choose whether to share its microphone, then **Open camera**.
3. The desktop shows the phone's live view. Take repeat photos from either device.
4. Choose **Try it on** for an OpenAI photo preview, or **Try it on live** for Lucy and GPT Live.
5. Phone microphone sharing is optional. Otherwise voice uses the desktop microphone. Replies play on the desktop.
6. Choose **Use photo mode** to return from live mode with the phone still connected.
7. Stop sharing on the phone, disconnect on the desktop, or close the live mirror to end the connection.

The photo stylist edits the current costume's choices. Generating or refreshing a photo remains an explicit button press. Full-costume cycling stays in the live mirror.

Both tabs must remain visible. Hiding either tab or locking the phone stops sharing. Unused pairing links expire after ten minutes. In testing mode, connected phone cameras and Lucy/GPT Live sessions have no app-imposed duration cutoff. Outside testing mode, phone streams end after ten minutes and mirror sessions after three minutes. See [testing policy](./mirror-session-limits.md). Freezing Lucy stops its paid connection while the phone's raw preview stays connected; the interface states that distinction.

## Configuration

Existing `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` store signaling. Existing `OPENAI_API_KEY` and `FAL_KEY` run inference.

For connections across restrictive networks, set server-only `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN`. The server requests 15-minute TURN credentials from [Cloudflare's documented credential endpoint](https://developers.cloudflare.com/realtime/turn/generate-credentials/). Never expose the long-lived key to the browser.

The deployed flow uses direct WebRTC with a public STUN server. Cloudflare Realtime is not required or configured. Use the same Wi-Fi network on both devices; guest networks with device isolation can prevent connection. Cross-network support is not guaranteed. A failed connection ends with a retry instruction instead of silently falling back to a desktop camera.

## Connection and media handling

- Desktop and phone use different random 256-bit bearer tokens. Only their hashes are stored.
- The phone token is in the URL fragment, which is not sent in HTTP requests or referrers. Treat the QR code as private.
- One phone can claim each code. The offer and answer are accepted once, only from the correct role.
- Signaling rows expire after ten minutes and are deleted on disconnect or subsequent database access after expiry. No photos or audio enter that table.
- Photos are bounded to 3 MB and transferred in 16 KB chunks. The desktop validates and prepares a photo before acknowledging receipt.
- Heartbeats stop media after an unresponsive peer. Closing, hiding, expiry, and late camera permission results release the camera.
- Lucy and GPT Live use cloned tracks. Stopping either inference session cannot silently kill the underlying phone connection.
- The old `/api/capture/:id` one-photo endpoint returns an expiry message. Old QR codes must be regenerated.

## Verification

Run `node scripts/verify-phone-camera.mjs` against a development server on port 3026. Set `PHONE_BASE_URL` for another deployment. The script creates synthetic fixtures using `ffmpeg` and macOS `say`. Alternatively, supply fixtures through `MIRROR_TEST_VIDEO` (Y4M) and `MIRROR_TEST_AUDIO` (WAV).

Set `PHONE_PROVIDER_E2E=1` to additionally run real OpenAI photo generation, GPT Live, and Lucy. This consumes provider credits. Tests use two independent browser sessions and never open personal hardware. Evidence goes to a temporary `phone-camera-e2e-*` folder.

Physical iPhone/Safari behavior, cellular connectivity, and camera quality must be distinguished from synthetic Chromium tests. Set `PHONE_FORCE_RELAY=1` to require and verify a TURN relay candidate. TURN is intentionally unconfigured at the owner's request; forced-relay verification therefore does not apply.

Verified locally: raw phone preview, repeated native-resolution photos with receipt acknowledgement, camera switching, a real OpenAI photo result, real Lucy output, spoken outfit edits through the phone microphone in both modes, mode switching without re-pairing, and full media cleanup. Typecheck, lint, build, and the existing 15 mirror checks passed. The final local run required at least 20 decoded Lucy frames and passed voice edits in both modes plus cleanup. Some earlier Lucy attempts returned `video_input_timeout`; the UI ended those sessions and showed an explicit retry. Hosted raw camera streaming, repeat photos, and real OpenAI photo generation passed. Hosted Lucy/GPT Live verification was blocked by the existing per-IP firewall limits after other live sessions used the allowance. No firewall rules were changed.
