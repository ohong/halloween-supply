# Semantic costume search and one-click creation

## Problem and success conditions

The landing page presents 25 looks without a way to describe an idea. A title-only
filter misses concepts such as "space explorer" or "Sherlock Holmes." An absent
costume needs a real next action, not another form.

- Search is the main landing-page action, above the existing gallery.
- Every keystroke updates local results without Enter or a network round trip.
- Meaning-based ranking refines results after a 350 ms pause.
- The latest query always wins. Clearing restores all 25 looks.
- Male/Female, Saved, hearts, and costume navigation keep working.
- A settled search without a strong match offers Create “query” once.
- One click starts real decomposition and supplier sourcing, then opens a saved look.
- Missing products remain explicit. No invented prices, photos, or suppliers appear.
- The flow works with keyboard controls and at 390, 760, and 1440 pixel widths.

## Decisions

**Search:** choose immediate local matching plus direct Anthropic semantic ranking.
Local matching uses editorial fields and a curated concept index. Anthropic ranks
only known catalog IDs. Embeddings would need another provider or a downloaded
model, which adds machinery for a 25-look catalog. Keep existing direct Anthropic
credentials. No new provider or model download is required.

**Creation:** save an unlisted custom look outside the reviewed editorial catalog.
Direct catalog publication would require three reviewed offers per component and
durable, deployed local images. It cannot honestly complete in one click today.
A custom look instead has a practical component plan and one live-verified product
per component where available. Its page shows actual merchant photographs, prices,
sizes, purchase links, and cart actions. Missing components are shown clearly.

Custom looks are reachable by an opaque UUID link and marked noindex. They are
unlisted, not authenticated private records. Do not add them to the global gallery,
weaken existing catalog publication checks, or generate placeholder model images.

## Search interaction

Keep the current restrained white/grey gallery, type, model toggle, and tile design.
Use one prominent text search field with a visible short label or heading:
"What do you want to be?" Placeholder: "A character, a creature, a whole mood…".
No eyebrow, feature badges, fake examples carousel, or additional hero prose.
The screenshot action becomes secondary.

Render matching tiles immediately. A small polite status announces result counts.
While semantic work runs, preserve the local results. Requests are debounced,
abortable, and guarded by the original normalized query. Do not clear good results
while a new request runs. Escape or the clear button empties the input.

Strong matches satisfy the requested costume or aesthetic. Related matches are
useful alternatives but must not suppress creation for a specific missing character.
For example, "space explorer" strongly matches Retro Astronaut; "Sherlock Holmes"
strongly matches Victorian Detective; "Batman" can have related looks but still
offers creation.

Intersect the ranked result list with Saved only after global search resolution.
No saved match is not proof that a costume is absent from the catalog. Offer
"Search all costumes" for a saved-only empty result.

On search service failure, retain local results and show a quiet retry or clearly
labelled custom-creation option. Do not state "not in our catalog" based on failure.

## Contracts and ownership

### Search backend (search_architecture)

Own lib/costume-search/* and app/api/costume-search/route.ts.

POST /api/costume-search
{ query: string } // trim/collapse spaces, 2–160 characters
Response:
{
  query: string,
  matches: { slug: string, relevance: "strong" | "related" }[],
  hasStrongMatch: boolean,
  source: "semantic" | "local"
}

Export browser-safe SearchResponse types and localSearch(query) from this module.
Validate slugs against the editorial catalog. Return unique ordered matches only.
Empty search is local, with no provider request. Reject oversize bodies. Bound
provider duration, per-process request quota/concurrency, cache size and TTL.
Keep queries out of logs. Cache normalized requests and deduplicate in-flight work.
Provider failure returns local results honestly labelled source: local.

### Creation backend (creation_architecture)

Own lib/custom-looks/*, app/api/custom-looks/route.ts,
app/create/[id]/page.tsx, and the reusable extraction from screenshot-costume.
Do not edit cart or checkout files; root owns those integrations.

POST /api/custom-looks
{ query: string, model: "male" | "female", requestId: UUID }
query is 3–160 normalized characters. Same-origin, bounded JSON body.
Response is NDJSON with these events:
{ t: "look", name: string, summary: string, pieces: CustomPiece[] }
{ t: "log", text: string }
{ t: "piece", i: number, item: CartItem }
{ t: "miss", i: number }
{ t: "done", id: UUID, href: "/create/<UUID>", found: number, missing: number }
{ t: "error", text: string }

CustomPiece: { name: string, slot: string, query: string, sizeKind: SizeKind }
CustomLook:
{
  id: UUID, query: string, model: "male" | "female",
  name: string, summary: string,
  state: "running" | "complete" | "partial" | "failed",
  pieces: { piece: CustomPiece, item: CartItem | null }[],
  createdAt: string, error?: string
}

Use direct Anthropic structured decomposition. Reuse existing merchant search,
Shopify variant checks, parsers and blocklists; extract these instead of cloning.
Persist rows in a separate Turso custom_looks table. requestId is the unique key:
claim the row atomically before paid work; duplicate requests never repeat work.
A completed duplicate returns the existing done event. A running duplicate responds
409 (the original request owns it); failed/stale attempts have an explicit retry
behavior, no silent duplicate inference. All terminal states persist.

One verified product per component is the first release. No artificial delays,
simulated progress, fixed-duration theater, or automatic image-generation spend.
No-result creation ends with a clear retryable error, not a purchasable success.
The server route loads a saved CustomLook and renders CustomLookView.
Invalid/missing IDs render the native not-found page. Next.js can send HTTP 200
when a missing record is discovered after streaming starts. Mark page metadata
noindex; API lookups and checkout still return explicit 404 responses.

### UI (landing_search_ui)

Own components/costume-gallery.tsx, components/store/custom-look.tsx,
and new focused CSS files. Do not edit globals.css unless root agrees.
Root will import a new landing-search.css if needed; prefer import from component.

Use localSearch and SearchResponse from search backend. Creation starts only on
explicit click; consume the stream in the landing page, show concise real progress
and retain the search on errors, then router.push(done.href).
Disable duplicate clicks and hold one requestId per attempted creation.
Abort abandoned requests and handle unmount safely. Never purchase automatically.

CustomLookView({ look }: { look: CustomLook }) shows the saved component plan with
real merchant photos (flat-lay / product board), clear missing pieces, prices,
sizes, merchant links and an Add found pieces button. Use custom-look:<UUID>
as cart costumeSlug. Root adds the cart/checkout integration for this source.
Use existing formatPrice (rounded dollars), cart controls and model preference.
Do not show a fabricated full-body image for new custom looks.

### Integration and verification (root plus QA agent)

Root owns cart, checkout, shared integration, spec, README, release.
QA agent owns read-only runtime scripts and independent review. No unit tests.
Check real semantic requests for titles, synonyms, natural-language ideas,
specific absent characters, rapid typing, empty/Saved states, and failure fallback.
Run one real custom creation, save its URL, inspect sourced merchant products and
refresh its saved page. Do not submit a purchase.
Run lint, typecheck, build and existing gallery/image verification.
Check the deployed release, not only localhost. Preserve concurrent work.

## Limits

Semantic refinement depends on the provider; immediate matching remains local.
Process-local quotas are cost guards, not a distributed abuse-prevention service.
Sourcing can be partial; there is no promise of three price tiers for new looks.
Prices and stock are checked again by existing checkout verification.
