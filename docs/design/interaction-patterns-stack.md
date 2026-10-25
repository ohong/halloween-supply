# Costume interaction patterns

Costume sourcing replaces its progress screens instead of keeping a useful assembled result. Inspecting, comparing, and buying pieces takes separate interactions. Voice feedback does not clearly distinguish work in progress from audio playback.

This branch collects seven independent UI changes. Each feature has its own pull request against `main`. The combined pull request is the single integration review and landing option; merging it also includes the feature commits.

| Feature | Pull request |
| --- | --- |
| Persistent assembling flat-lay | [#7](https://github.com/ohong/halloween-supply/pull/7) |
| Wardrobe comparison rail | [#8](https://github.com/ohong/halloween-supply/pull/8) |
| Inline screenshot item inspection | [#9](https://github.com/ohong/halloween-supply/pull/9) |
| Direct worn-look / pieces navigation | [#10](https://github.com/ohong/halloween-supply/pull/10) |
| Voice activity indicator | [#11](https://github.com/ohong/halloween-supply/pull/11) |
| Shoppable selected-product tags | [#12](https://github.com/ohong/halloween-supply/pull/12) |
| Readable live conversation transcript | [#13](https://github.com/ohong/halloween-supply/pull/13) |

## User outcomes

1. See sourced products assemble into a persistent flat-lay as results arrive.
2. Inspect a piece, choose its size, and add it without leaving the look.
3. Connect the worn inspiration image with the real selected products and prices.
4. Compare alternative pieces in an image-led wardrobe rail.
5. Read what the voice stylist heard and said as text arrives.
6. Distinguish voice connection, listening, processing, playback, mute, and error states.
7. Move directly between the worn look and the assembled product view.

The existing monochrome visual system, catalog choices, cart behavior, and inspiration disclosures remain the basis of these changes.

## Scope choices

A shared selection and inspection flow keeps the shopping path coherent. Separate screen effects would be easier to add but would duplicate item details and interaction rules.

The pieces overview and worn-image product tags open the same inline inspector. Alternatives keep the selected products, displayed prices, and existing cart lines synchronized. Gallery selection survives resizing and product-photo substitutions.

Real sourcing events drive the screenshot assembly. The saved catalog sourcing demonstration remains labeled as a replay. Merchant photos remain usable when a transparent cutout is unavailable.

Full 3D explosion, photo segmentation, swinging hanger physics, and animated receipt printing are excluded. They add work without a comparable gain in the core discovery-to-cart demonstration.

## Verification

Each feature pull request records its own checks. The combined pull request records desktop and phone browser checks, integration checks, build results, and remaining limits. Local fixture-driven UI checks do not establish live provider quality, latency, or merchant fulfillment.

Reproduce the local checks:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run build
bun run start --port 3122
# In another terminal:
node scripts/verify-interaction-patterns.mjs http://localhost:3122
VOICE_STATE_BASE_URL=http://localhost:3122 node scripts/verify-voice-state.mjs
```

The shopping check serves controlled streaming sourcing events through a local proxy and blocks other non-read API calls. The voice check uses real loopback WebRTC with synthetic audio and intercepted provider signaling. Both use the actual app UI and write screenshots and results to a temporary evidence folder.

No production database writes, checkout submission, model inference calls, or personal camera/microphone capture are needed. Physical mobile devices, Safari, deployed provider behavior, and live sourcing latency remain unverified.
