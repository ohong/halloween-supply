# Costume interaction patterns

This branch collects seven independent UI changes. Each feature has its own pull request against `main`. The combined pull request is the single integration review and landing option; merging it also includes the feature commits.

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

Real sourcing events drive the screenshot assembly. The saved catalog sourcing demonstration remains labeled as a replay. Merchant photos remain usable when a transparent cutout is unavailable.

Full 3D explosion, photo segmentation, swinging hanger physics, and animated receipt printing are excluded. They add work without a comparable gain in the core discovery-to-cart demonstration.

## Verification

Each feature pull request records its own checks. The combined pull request records desktop and phone browser checks, integration checks, build results, and remaining limits. Local fixture-driven UI checks do not establish live provider quality, latency, or merchant fulfillment.
