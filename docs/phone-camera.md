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

For connections across restrictive networks, set server-only `METERED_TURN_APP` (the subdomain in `<app>.metered.live`) and `METERED_TURN_API_KEY`. Use the credential API key for an existing Metered TURN credential. The server fetches TURN credentials from [Metered's credential endpoint](https://www.metered.ca/docs/turn-rest-api/get-credential/) when a phone pairs. Never expose the API key to the browser.

The implemented relay provider is **Metered**, not Cloudflare. The flow tries direct WebRTC first. Validated TURN credentials let Metered relay encrypted traffic when direct connectivity fails. A full media server is unnecessary for one phone paired with one desktop; TURN preserves the existing peer connection and photo data channel.

Two approaches were considered: finish the existing Metered adapter, or add a Cloudflare TURN adapter. Metered preserves the current configuration and needs one small credential request. Cloudflare adds a separate credential format and provider setup, without available credentials to verify it. This change retains Metered. It does not create subscriptions or change account privileges.

The claim response reports `relayStatus` as `unconfigured`, `unavailable`, or `ready`, plus `relayProvider` and `relayAvailable`. `ready` means the server fetched and validated credentials; it does not prove the browser used a relay. Missing credentials use direct STUN discovery. Incomplete credentials, invalid configuration, provider errors, and the eight-second relay timeout also use direct discovery, with an on-screen warning. Some networks require TURN and cannot connect through this fallback. The UI recommends the same Wi-Fi network or a fresh QR code. It never opens the desktop camera automatically.

Connection candidates are exchanged as they arrive, including relay candidates discovered after the initial offer or answer. The former six-second gathering cutoff could drop those candidates. The authenticated signaling table stores bounded candidate lists and removes them with the pairing session.

Connection progress distinguishes connection creation, network setup, camera permission, signaling, video connection, and reconnecting. Each signaling request has a twelve-second total deadline and at most two retries for transport errors or HTTP 429/502/503/504. Repeating the exact offer or answer is safe after a lost response. Different replacement descriptions remain rejected. Camera permission has a thirty-second deadline; a camera granted after cancellation or timeout is stopped immediately. Initial peer negotiation has a sixty-second deadline after the phone joins.

Brief WebRTC disconnections retain the existing stream for up to twelve seconds. If the browser reconnects, sharing continues without acquiring another camera. An unrecovered transport, closed control channel, or missed heartbeat stops sharing and gives a fresh-code instruction. This recovery window does not perform an ICE restart or reuse an expired/closed link. It cannot guarantee recovery after every network change.

## Connection and media handling

- Desktop and phone use different random 256-bit bearer tokens. Only their hashes are stored.
- The phone token is in the URL fragment, which is not sent in HTTP requests or referrers. Treat the QR code as private.
- One phone can claim each code. The offer and answer are accepted once, only from the correct role.
- Signaling rows expire after ten minutes and are deleted on disconnect or subsequent database access after expiry. No photos or audio enter that table.
- Photos are bounded to 3 MB and transferred in 16 KB chunks. The desktop validates and prepares a photo before acknowledging receipt.
- Heartbeats stop media after an unresponsive peer. Closing, hiding, expiry, and late camera permission results release the camera.
- The phone requests a screen wake lock where supported. It releases the lock when sharing stops. Browser refusal still requires keeping the screen awake manually.
- Lens switching releases the old lens before opening the other lens for iOS compatibility. If the new lens fails, it tries to restore the previous camera without replacing the microphone or connection. Stopping during a pending switch releases the late camera track.
- Lucy and GPT Live use cloned tracks. Stopping either inference session cannot silently kill the underlying phone connection.
- The old `/api/capture/:id` one-photo endpoint returns an expiry message. Old QR codes must be regenerated.

## Verification

Run `node e2e/verify-phone-camera.mjs` against a development server on port 3026. Set `PHONE_BASE_URL` for another deployment. The script creates synthetic fixtures using `ffmpeg` and macOS `say`. Alternatively, supply fixtures through `MIRROR_TEST_VIDEO` (Y4M) and `MIRROR_TEST_AUDIO` (WAV).

Set `PHONE_PROVIDER_E2E=1` to additionally run real OpenAI photo generation, GPT Live, and Lucy. This consumes provider credits. Tests use two independent browser sessions and never open personal hardware. Evidence goes to a temporary `phone-camera-e2e-*` folder.

Physical iPhone/Safari behavior, cellular connectivity, and camera quality must be distinguished from synthetic Chromium tests. Set `PHONE_FORCE_RELAY=1` to require and verify a TURN relay candidate. Set `PHONE_DELAY_CANDIDATES=1` to delay candidate delivery beyond the old six-second cutoff and verify that pairing still completes.

Set `PHONE_RELIABILITY_E2E=1` to inject a lost offer response, a temporary candidate-service error, brief and persistent disconnect states, a failed lens request, and a late permission result. The test still sends real synthetic video and photos between two Chromium contexts. The injected disconnect state checks recovery handling; it is not proof of a physical network handoff. Set `PHONE_TESTING_MODE=1` when the server uses `TRY_ON_TESTING_MODE=1` to check that connected sessions clear the ten-minute timer.

Add `PHONE_PERMISSION_TIMEOUT_E2E=1` to the reliability run to also wait for the actual thirty-second permission deadline. Set `PHONE_EXPECT_RELAY_STATUS` to check the server's expected relay state. An incomplete Metered configuration can verify the `unavailable` warning and direct fallback without contacting a relay provider.

The connection repair passed raw streaming, delayed candidate delivery (seven seconds), repeated full-resolution photo capture, camera switching, disconnect during camera switching, and all-track cleanup in two Chromium contexts. The reliability run also passed lost-offer-response recovery, a temporary signaling error, injected brief and persistent disconnect states, a new-QR reconnect, failed-lens restoration with the same microphone, direct fallback under incomplete relay configuration, stopped permission requests, and the actual thirty-second camera-permission timeout. Late camera tracks were released after both cancellation and timeout. Authentication checks reject missing credentials, another phone claimant, wrong-role descriptions, unauthorized candidate writes, and oversized candidate lists. These checks do not establish physical iPhone/Safari connectivity.

The local environment checked for this change has neither Metered nor Cloudflare TURN credentials. Forced-relay streaming, separate-network pairing, physical iPhone/Safari behavior, and cellular handoffs remain unverified. Earlier Cloudflare dashboard notes do not describe the implemented adapter. Report a relay as used only after forced-relay streaming confirms a selected `relay` candidate.
