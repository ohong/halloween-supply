# Halloween Supply — product brief

Updated November 5, 2026. Halloween Supply helps people choose a recognizable
costume, buy the pieces they need, and preview their choices. Product usefulness
comes before a demonstration or competition submission.

The current curated catalog contains 50 looks, with three price tiers per
purchasable component. Search, custom product boards, screenshot sourcing, photo
try-on, live mirror controls, and guest checkout extend that catalog.
The [campaign ledger](docs/swarm/2026-11-05/README.md) separates source changes,
runtime evidence, and work that remains blocked.

## Success conditions

1. A shopper can find a recognizable look within a stated new-piece budget.
2. The page separates new purchases from clothing the shopper already owns.
3. Saved and shared shopping choices restore without exposing private sizes.
4. Sourced boards retain useful products when a search is incomplete or retried.
5. Personal previews use the selected products and remain clearly approximate.
6. Checkout explains a failing item and preserves unrelated cart choices.
7. Event notes show assembly work and delivery uncertainty before checkout.
8. Release evidence identifies the checked commit, runtime, providers, and limits.

Halloween has passed. Event readiness applies to the shopper's stated event date.
Processing time alone does not establish arrival. Unknown delivery remains
visible; pickup requires its own evidence.

## Product decisions

**Catalog.** Preserve the 50 reviewed catalogs. Completion kits are a small overlay
that selects defining pieces and states owned basics. A kit subtotal covers only
its new pieces. It is distinct from a full-piece subtotal. Custom looks remain
unlisted product boards with their own missing-piece states.

**Sourcing.** Retailers and marketplaces are allowed, including larger merchants.
Independent, vintage, secondhand, Etsy, and niche DTC products remain useful
sources. Location alone does not establish availability, pickup, or suitability.
Use direct merchant facts, safe product URLs, and current checkout checks.
Never invent a price, stock status, delivery promise, or size guarantee.

**Curation and state.** Keep editorial defaults and alternatives. A shopper may
swap a product, mark a piece owned, skip an optional piece, mix looks, or change
presentation. Save those choices as one validated selection. A visual color edit
is a preview edit unless the shopper selects a matching merchant variant.

**Sizes and privacy.** Size selections stay local or travel privately with cart
and checkout requests. Public look links exclude sizes, personal photos, and
generated previews. Clearing site data can remove saved looks and the cart.

**Business model.** Guest checkout charges the sum of merchant prices. There is
no concierge fee, markup, or shipping line. The concierge absorbs merchant
shipping and places orders manually. Stripe collects email and a US shipping
address. A checkout session does not reserve stock or prove a fulfilled order.

**Media.** Photo preview and live video are optional. Provider configuration,
successful provider sessions, synthetic-browser checks, and physical-device checks
are separate facts. Preserve unrestricted repeated demonstrations. Do not restore
removed hourly quotas. Consent, bounded inputs, timeouts, and limits on
simultaneous work still apply.

**Measurement.** Use anonymous, allowlisted funnel events and existing hosting
logs. Exclude photos, prompts, raw queries, private sizes, payment details,
addresses, IP addresses, and phone tokens from event payloads. Report measured
usage units; claim vendor cost only with matching billing evidence.

## Implementation boundaries

Turso stores one validated JSON catalog per costume. Shared catalog functions
supply pages, assistant tools, and checkout. Bundled data provides a read fallback.
Publication and refresh preserve unrelated fields and all 50 reviewed catalogs.
No graph database is required.

Checkout independently refreshes merchant price, size, and stock. A price change
requires shopper acceptance. Recovery should focus the affected line, show
confirmed options, and preserve every unrelated selection. Structural catalog
health and merchant verification remain separate.

Screenshot sourcing streams candidates and verified cart items as distinct states.
The default image reader is Luna. Optional OpenCV measurements supplement it;
failed measurements must retain the documented fallback and approval behavior.
Saved-board photo preview should adapt existing records rather than replace all
curated, mirror, cart, and 3D state handling.

The app uses Next.js 16, React 19, TypeScript, Bun, Turso, and hosted Stripe
Checkout. Text, image, voice, video, sourcing, and relay providers have separate
configuration and failure states. Read the relevant guides under
`node_modules/next/dist/docs/` before writing Next.js code.

## Release boundary

Local lint, types, build, and browser checks establish only their recorded scope.
A deployed release must report the intended commit and pass critical shopping
checks on that host. Real-provider and physical-device checks require their own
evidence. This document does not authorize deployment, payment, or submission.

Post-payment automation, fulfillment visibility, shipping economics, broader
catalog expansion, another mirror redesign, and further 3D polish are separate
work. The user owns the competition video submission. COOL performance remains
unverified until a measured comparison supports it.
