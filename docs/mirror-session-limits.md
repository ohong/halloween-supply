# Demo testing policy

`TRY_ON_TESTING_MODE=1` is enabled in Vercel production and preview for the live demo.
The four existing request-limit firewall rules are disabled. This is a temporary,
reversible testing configuration, not a new permanent public quota policy.

Testing mode disables:

- Per-process photo attempts and photo concurrency quotas.
- Video, voice, styling-command, outfit-reference and phone-pairing request quotas.
- The app's three-minute Lucy and GPT Live session cutoffs.
- The ten-minute cutoff for an already connected phone camera.

Unused phone links still expire after ten minutes. One-phone claiming, role tokens,
origin checks, upload validation and size limits remain enforced. Closing or hiding
pages, disconnecting, freezing video, and connection failures still release media.
Providers can still reject requests or end sessions under their own policies.

## Cause and fix

The mirror originally allowed three starts per public IP per hour, shared by everyone
on one Wi-Fi network. Raising video and voice limits fixed that block, but a separate
three-photo firewall rule still rejected uploads. The firewall returned HTML with 403,
so the photo UI displayed its generic preview failure. Request logs confirmed these
blocks occurred before the application or image provider ran.

Disabling the four firewall quotas removes that cause. The server-only testing flag
also bypasses lower application quotas and tells clients not to impose session cutoffs.
The photo UI now distinguishes blocked, rate-limited, oversized and timed-out requests.
A flag keeps restoration explicit and avoids deleting the normal quota behavior.

## Restore limits after testing

1. Set `TRY_ON_TESTING_MODE=0` in the intended Vercel environments and redeploy.
2. Enable these four existing project firewall rules and inspect the draft:

| Rule | ID | Normal limit |
| --- | --- | --- |
| Try-on request limit | `rule_try_on_request_limit_3Gaj22` | 3 photo requests/hour/IP |
| Mirror video sessions | `rule_mirror_video_sessions_n2Vejl` | 30 starts/hour/IP |
| Mirror voice sessions | `rule_mirror_voice_sessions_by1Vrv` | 30 starts/hour/IP |
| Mirror styling requests | `rule_mirror_styling_requests_q4q6WP` | 30 commands/hour/IP |

3. Publish the reviewed firewall draft.

Changing only the environment flag does not enable the firewall. Existing open tabs
must reconnect or reload to receive the updated session policy. Testing mode allows
more paid requests and longer sessions; it is not a spending cap.

## Verification

- `bun scripts/verify-try-on.mjs` checks input validation, default quota, repeated
  testing-mode requests and quota restoration with simulated provider responses.
- `TRY_ON_DEMO_E2E=1 TRY_ON_BASE_URL=https://halloween.supply node scripts/verify-demo-try-on.mjs`
  runs four real browser uploads and generated previews on one network, crossing the
  old photo quota. It uses a catalog model fixture and consumes provider credits.
- `PHONE_PROVIDER_E2E=1 PHONE_SKIP_PHOTO=1 PHONE_BASE_URL=https://halloween.supply node scripts/verify-phone-camera.mjs`
  exercises paired camera video, Lucy, GPT Live outfit changes and media cleanup.
