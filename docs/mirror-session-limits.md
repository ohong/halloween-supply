# Mirror session behavior

The app has no hourly request quotas. Shoppers can start or resume live video,
restart voice, change pieces, pair a phone camera, and repeat the demo without
using a shared hourly allowance.

The project firewall has no hourly rate-limit rules. The four former rules for
photo try-on, live video, voice, and mirror commands were removed. App-side
IP counters were removed from these flows and from screenshot sourcing, custom
looks, outfit styling, and costume search.

`TRY_ON_TESTING_MODE=1` disables app video, voice, and connected-phone session
cutoffs for rehearsal. It also bypasses the simultaneous photo-work guard.
Outside testing mode, each video connection lasts up to three minutes.
Changing the setting does not restore hourly request quotas. Provider errors
and provider-side limits can still occur and are reported separately.

Origin checks, consent, upload limits, request timeouts, and bounds on
simultaneous work remain. These do not limit repeated sessions per hour.

Run `LIVE_MIRROR_E2E=1 MIRROR_BASE_URL=https://halloween.supply node scripts/verify-live-mirror.mjs`
to verify real voice/video, mute, freeze/resume, saving, look changes, media
release, restored shopping choices, and responsive navigation. The test uses
synthetic media and consumes provider credits.
