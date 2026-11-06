# Halloween Supply: ten opportunities for a three-hour agent campaign

Prepared October 27, 2026, at about 9:16 p.m. Pacific. This is an advisory review, with no product implementation.

The recommended goal is to help someone choose a recognizable costume, buy only the pieces they need, preview those choices, and complete a reliable shopping flow. Product usefulness comes first. A convincing demonstration follows from that flow.

Spend the available intelligence on product research, state correctness, and independent runtime checks. These activities can use many agents without making many agents edit the same component.

## Current evidence

- Production health reports commit `2062f165f397ff8d8a9cf5fbeb908e0561e9068b`, healthy Turso access, 50 complete costumes, and 470 unique products. Stripe uses a test key. [Live health](https://halloween.supply/api/health).
- The live homepage and Cosmic Cowboy page were inspected in the browser. Search, Saved, model selection, shopping alternatives, photo try-on, and the budget assistant already exist. Cosmic Cowboy's displayed default subtotal is $489 across five shops.
- The public mirror configuration reports video and voice available, with `maxSessionSeconds: null`. This establishes configuration, not successful provider sessions. [Mirror configuration](https://halloween.supply/api/live-mirror/video).
- Read-only analysis of the bundled catalogs on that production commit finds 242 components and 726 product references. The median lowest-priced complete piece set is **$171.86**. Only **four of 50** sets cost at most $100. The median default set costs about **$354**. These are listed merchandise subtotals, including every component, before shipping and tax. They are not live merchant quotes or size-specific guarantees.
- The [saved price analysis](/Users/ohong/dev/halloween-supply/advisor-plans/2026-10-27-catalog-price-analysis.json) includes all 50 subtotals, the source commit, and the calculation method.
- The bundled products include 12 records with unknown stock. Their dates are snapshot facts: 341 checked October 25, 41 October 26, and 88 October 27. Live database freshness was not independently enumerated.
- Today's catalog repair already corrected selected-variant refresh behavior and restored all 50 shopping catalogs. Its recorded checks cover 13 offers and four production test checkouts. This work should be preserved, rather than proposed again. [PR #32](https://github.com/ohong/halloween-supply/pull/32), [repair evidence](https://github.com/ohong/halloween-supply/blob/2062f165f397ff8d8a9cf5fbeb908e0561e9068b/docs/sourcing/variant-refresh-2026-10-27.md).
- Agent-readable guides, metadata, sitemap, trust pages, and Markdown negotiation have already shipped. The latest related chat records a 100/100 audit and 106 production checks. This review inspected the sources and saved evidence; it did not rerun that external score. [Production verification](https://github.com/ohong/halloween-supply/blob/2062f165f397ff8d8a9cf5fbeb908e0561e9068b/docs/verification/agent-readiness-production.json).
- The current local checkout is at `3c9d8406f0e0b4401c67adeb1c1ce8a778b1296f`, six commits ahead and 24 behind the recorded `origin/main`. It also has 15 modified tracked files and an existing notes lock. The six commits concern mirror behavior and layout. Most unstaged changes broaden merchant sourcing. The local checkout is unsuitable as an unexamined common swarm base.
- GitHub currently shows three open PRs: Gemini Live voice **#25**, clip input **#26**, and competition docs **#27**. No open issues were returned. The queried production commit has a successful Vercel status. No `.github` workflow files exist on the inspected default-branch tree.

The review covered product goals, recent relevant chats, current and unshipped source differences, shopping state, sourcing, checkout, media connections, and verification scripts. It did not run paid inference, create checkout sessions, test physical devices, inspect actual conversion data, or perform an exhaustive security or dependency audit.

## Why this direction

Two approaches are plausible:

| Approach | Benefit | Cost and constraint |
| --- | --- | --- |
| Expand the feature surface: more costumes, another voice provider, richer 3D, more infrastructure | More demonstrations and entry points | Existing state, shopping, and device gaps remain; provider and hardware dependencies limit parallel gains |
| Complete the existing journeys and make ten existing costumes practical to buy | Uses the 50-look catalog and existing AI features immediately | Requires careful merchant evidence and shared-state integration |

Choose the second approach. The current product already has substantial breadth. The highest-return additions make that breadth useful to a person finishing a costume.

The ranking weighs likely user value, strength of evidence, agent effort, regression risk, and independent work available. It is a judgment, not a predicted conversion lift. One agent-hour means one agent working for one hour, including tools and verification. Estimates are planning ranges.

| Rank | Improvement | Main return | Estimated agent-hours | Evidence confidence |
| --- | --- | --- | --- | --- |
| 1 | Affordable completion kits and price-aware discovery | Makes existing looks practical purchases | 5–7, sharing research with #3 | High on price gap; medium on demand |
| 2 | Preserve the complete look through save, refresh, and sharing | Repairs lost choices and supports sharing | 2–3 | High |
| 3 | Event and assembly readiness for priority looks | Makes late-October shopping decisions useful | 3–4, sharing research with #1 | High on evidence gap |
| 4 | Connect screenshot and custom results to personal photo preview | Completes the strongest existing product story | 5–7 | High on missing connection; medium on effort |
| 5 | Recover checkout failures inside the cart and expose catalog freshness | Helps shoppers finish instead of restarting | 2–3 | High |
| 6 | Finish the phone-camera connection path | Closes a reported real-device failure | 2–4 plus credentials and physical testing | High on recorded problem; current relay state unverified |
| 7 | Measure and integrate the best mirror control changes | Improves the voice demonstration without a rewrite | 3–4 | High on branch divergence; outcome needs measurement |
| 8 | Measure shopping outcomes, provider delay, and usage | Makes the next investment evidence-based | 2–3 | High on missing app events; business impact unmeasured |
| 9 | Establish one release base and automate existing runtime checks | Protects the work of the whole swarm | 3–4 | High |
| 10 | Finish the existing clip-input PR behind a verified feature flag | Adds a useful input with substantial code already written | 1–3 plus provider availability | Medium |

Run #9's release-base work first. Business rank and execution order serve different purposes.

## Bounded work packages

**1. Affordable completion kits and price-aware discovery**

The current three-tier catalog offers relative price choices. It does not ensure an affordable complete costume. The homepage receives piece counts but no price summary. Its filters cover search, Saved, and model presentation. [Gallery source](https://github.com/ohong/halloween-supply/blob/2062f165f397ff8d8a9cf5fbeb908e0561e9068b/components/costume-gallery.tsx#L181), [homepage data](https://github.com/ohong/halloween-supply/blob/2062f165f397ff8d8a9cf5fbeb908e0561e9068b/app/page.tsx#L15).

Create practical versions of ten existing looks. Start with looks whose identity survives inexpensive defining pieces and common owned basics. Show what the shopper must already own, the exact new pieces, their subtotal, and any assembly supplies. Add a compact price filter and distinguish a full-piece subtotal from a completion-kit subtotal. Reuse the existing owned-piece behavior and budget calculation.

Choose a kit overlay on existing catalogs over replacing all default picks. The overlay preserves editorial choices and three price tiers. Replacing the catalog would increase sourcing work and regression risk. Reconcile the already requested broad-retailer policy: production allows Amazon.com but still blocks many other large retailers; the broader change remains local. [Current blocklist](https://github.com/ohong/halloween-supply/blob/2062f165f397ff8d8a9cf5fbeb908e0561e9068b/lib/sourcing/blocklist.ts#L4).

Done means ten evidence-backed kits have an explicit owned-basics list and a target new-piece subtotal of at most $100. Any kit that misses the target reports its actual subtotal. The gallery filter agrees with the selected kit. Adding it charges only selected new pieces. Availability and shopper sizes remain explicit conditions.

Four research agents can work on separate costume files. One discovery UI owner integrates their validated output. Research should use built-in web search and direct merchant evidence.

**2. Preserve the complete look through save, refresh, and sharing**

Sharing already exists. The concrete gap is state completeness: `VirtualTryOn` receives owned and skipped pieces, but `lookUrl` writes only product IDs and mixes. The receiving page can read owned/skipped parameters that the share builder does not supply. Hearts save a costume slug, rather than a customized selection. [Share builder](https://github.com/ohong/halloween-supply/blob/2062f165f397ff8d8a9cf5fbeb908e0561e9068b/lib/share-card.ts#L12), [share caller](https://github.com/ohong/halloween-supply/blob/2062f165f397ff8d8a9cf5fbeb908e0561e9068b/components/store/virtual-try-on.tsx#L62), [restoration](https://github.com/ohong/halloween-supply/blob/2062f165f397ff8d8a9cf5fbeb908e0561e9068b/components/store/costume-experience.tsx#L52).

Extend the validated selection representation to cover products, owned/skipped pieces, mixes, presentation preference, and separately labeled preview edits. Keep private sizes local. Save the selection locally and make its shopping choices transferable through a link. Personal photos and generated previews retain their temporary handling.

Choose a versioned selection snapshot with existing URL support over adding accounts and cloud photo storage. This gives refresh and cross-browser restoration with much less work. A visual color edit remains a preview edit unless a corresponding merchant variant is selected.

Done means a fresh browser restores a swapped product, one owned required piece, one skipped optional piece, and a mix. Subtotals and cart contents agree. Invalid or retired selections produce a clear repair state. A refresh does not reset a saved customized look.

The look-state backend owner and look UI owner share this package with #4. They own different files and agree on the contract first.

**3. Event and assembly readiness for priority looks**

The product model has price, sizes, stock, and checked-at facts, but no structured shipping or assembly evidence. The stylist can reject explicitly late descriptions, while its response deliberately says delivery is unconfirmed. [Product fields](https://github.com/ohong/halloween-supply/blob/2062f165f397ff8d8a9cf5fbeb908e0561e9068b/lib/types.ts#L73), [timing behavior](https://github.com/ohong/halloween-supply/blob/2062f165f397ff8d8a9cf5fbeb908e0561e9068b/lib/stylist/timing.ts#L28), [delivery contract](https://github.com/ohong/halloween-supply/blob/2062f165f397ff8d8a9cf5fbeb908e0561e9068b/lib/stylist/contracts.ts#L34).

For the same ten kits, record published processing times, merchant shipping-policy links, any verified pickup option, required tools, and assembly steps. Show event constraints before the cart. Use explicit states such as known too late, delivery unconfirmed, and pickup option found. Processing time alone does not establish arrival.

Choose narrow, sourced readiness notes over a destination-specific shipping calculator. The latter needs address, carrier, service, and inventory data the app does not have. Merchant pickup and delivery claims require their own evidence.

Done means each priority kit states its owned pieces, extra supplies, assembly work, and delivery evidence. An October 31 selection excludes explicitly late options. Unknown arrival remains visible. Research files include source URLs and check dates; a single publisher validates shared products before database changes.

The four catalog researchers share this work with #1. One research agent also validates the assembled evidence schema. The discovery UI owner adds the summary; the look UI owner owns any costume-page insertion.

**4. Connect screenshot and custom results to personal photo preview**

The screenshot board streams candidates and supports the cart. It keeps its source image in page state and reconstructs purchased pieces from the cart. Custom looks have saved product boards. Personal photo preview currently assumes a curated costume slug and curated references. This leaves inspiration sourcing and personal preview as separate journeys. [Screenshot board](https://github.com/ohong/halloween-supply/blob/2062f165f397ff8d8a9cf5fbeb908e0561e9068b/components/store/screenshot-costume.tsx#L43), [custom board](https://github.com/ohong/halloween-supply/blob/2062f165f397ff8d8a9cf5fbeb908e0561e9068b/components/store/custom-look.tsx#L10), [preview assumptions](https://github.com/ohong/halloween-supply/blob/2062f165f397ff8d8a9cf5fbeb908e0561e9068b/components/store/virtual-try-on.tsx#L26).

Persist the sourced product selection using the existing custom-look storage patterns. Let a saved screenshot or custom board request a personal photo preview from those exact, server-resolved products. Reuse #2's shopping selection. Retain found pieces when a search is partial, and allow a missing piece to be retried independently.

Choose adapters around saved look records over a rewrite of every costume, mirror, cart, and 3D state machine. The first release covers photo preview and cart continuity. Live video and 3D can follow after that path is proven.

Done means one real screenshot flow survives refresh, produces a personal preview from its saved products, and adds those same products to the cart. One partial result retains its found items through retry. Existing curated photo previews continue working. Both default and optional OpenCV sourcing paths keep their current streaming and approval behavior.

This is the largest integration risk. By minute 45, the backend owner must demonstrate server-resolved references for both curated and saved looks. If that contract is not ready, ship saved-board continuity as the bounded slice and keep preview integration in review.

**5. Recover checkout failures inside the cart and expose catalog freshness**

The server already returns typed sold-out, invalid-size, and unverified responses. The drawer collapses them into a message, discarding useful item-specific recovery data. Health checks catalog structure and price-tier coverage; it does not establish fresh stock or successful merchant checks. [Cart response handling](https://github.com/ohong/halloween-supply/blob/2062f165f397ff8d8a9cf5fbeb908e0561e9068b/components/store/cart-drawer.tsx#L99), [health definition](https://github.com/ohong/halloween-supply/blob/2062f165f397ff8d8a9cf5fbeb908e0561e9068b/app/api/health/route.ts#L19).

Keep the typed response in the drawer. Focus the affected line, offer confirmed sizes, and link to actual alternatives. Preserve every unrelated choice. Add a compact operational summary of the last refresh, unresolved offers, and stale checks. Keep structural completeness and merchant verification as separate facts.

Choose recovery using existing server result fields over a new shopping agent or relaxed payment checks. Today's pinned-variant fix remains the verifier baseline. A missing size or merchant outage should help the shopper repair a line.

Done means a real invalid-size case exposes available sizes; a failed merchant check retains the cart; a replacement returns to checkout; and price changes still require acceptance. A valid flow creates an unpaid Stripe test session that is then expired. Refresh status identifies unresolved products without erasing known product facts.

One checkout owner handles the route, types, drawer, and refresh summary. Other agents submit proposed changes through that owner.

**6. Finish the phone-camera connection path**

The relevant chat records a physical phone connection failure and a later direct-connection repair. Forced relay and physical iPhone/Safari verification remained open. Source uses a Metered TURN credential endpoint, while the documentation also claims Cloudflare performs the relay. [Active adapter](https://github.com/ohong/halloween-supply/blob/2062f165f397ff8d8a9cf5fbeb908e0561e9068b/lib/phone-camera/server.ts#L68), [recorded limits](https://github.com/ohong/halloween-supply/blob/2062f165f397ff8d8a9cf5fbeb908e0561e9068b/docs/phone-camera.md#L30).

TURN is the relay used when devices cannot connect directly. Both providers offer credential mechanisms, but their adapters differ. [Metered contract](https://www.metered.ca/docs/turn-rest-api/get-credential/), [Cloudflare contract](https://developers.cloudflare.com/realtime/turn/generate-credentials/).

Prefer completing the existing Metered adapter if usable credentials are already available. An alternative is a small Cloudflare credential adapter after activation is verified. This is a relay task; a full media-server migration adds unnecessary work. Resolve the provider naming and diagnose failures by connection stage.

Done means forced-relay browser verification plus a physical phone on a different network can stream, capture a photo, flip lenses, reconnect, and stop all tracks. Synthetic Chromium and physical-device results are reported separately.

Give one camera owner a 30-minute dependency check. If credentials or physical testing remain unavailable, deliver the diagnostic and tested direct/photo fallback without claiming relay completion. Account activation can exceed the three-hour window.

**7. Measure and integrate the best mirror control changes**

Six local-only commits contain immediate Decisions actions, lower voice reasoning, parallel follow-up calls, identity-reference changes, a new catalog selector, and layout changes. Production has newer OpenCV and catalog fixes. These histories need selective reconciliation.

Start by comparing the behavior changes in `5f3ac4d` and `bf8c364` with production. Measure command recognition, selected product IDs, state application, first visible frame, and spoken completion separately. Include a cheaper-jacket request, whole-costume switch, color-only preview edit, owned-piece preservation, undo, and interrupted speech.

Choose the existing voice path with measured improvements over immediately switching to the second provider in PR #25. Preserve successful connections across changes. Treat a send acknowledgement and a visibly correct garment as separate evidence. Existing undo and feedback features are reused, not rebuilt.

Done means a fixed command set changes the intended pieces, preserves unrelated choices, and produces paired before/after latency records. Any fidelity claim includes visible output review. No sub-second result is assumed. The owner reconciles useful commits without including an unreviewed layout redesign or overwriting newer production behavior.

One mirror owner and an independent QA agent can run this lane. Keep the user's unrestricted testing behavior and relaxed main-subject photo handling. Track usage without quietly restoring removed quotas.

**8. Measure shopping outcomes, provider delay, and usage**

Source inspection found operational logs and verification scripts, but no application funnel-event integration. Hosting analytics may exist; this review did not establish visitor conversion or provider spending.

Record anonymous events for look view, kit selection, piece swap, preview request/completion/failure, cart addition, checkout start, and checkout recovery. Record operation durations and provider-reported usage where available. Label test traffic and provider modes. Keep photos, prompts, raw search text, shipping details, and phone-pair tokens out of the event payload.

Choose a small event contract and the existing hosting log path over introducing another analytics platform during this campaign. Produce a read-only summary for the demonstration. Exact vendor cost requires the matching usage and billing data; otherwise report usage units.

Done means a browser run produces the expected event sequence with one anonymous journey identifier. The summary distinguishes a discovered candidate, a cart-ready offer, a generated preview, and a checkout start. It reports time to first result, total sourcing time, preview duration, and explicit failure stages.

One measurement owner creates the helper and reporting script. Feature owners add agreed calls in files they own.

**9. Establish one release base and automate existing runtime checks**

The repo has many useful runtime verification scripts. They do not form an observed GitHub Actions gate. The brief and task list still describe an early one-costume product and some retired infrastructure. Combined with divergent local history, this creates avoidable coordination risk.

Start isolated branches from the verified production baseline, after checking for a newer release. Preserve the current dirty checkout. Identify local patches that reflect accepted user decisions, especially broader merchant sourcing. One integrator owns shared types, database publication, and the release branch.

Choose a small workflow around existing checks over a new test framework or broad unit-test project. Use lint, type generation, production build, and selected browser/HTTP checks. Keep real-provider media rehearsals as an explicit bounded release check. Refresh the brief and task list to describe the actual product and known open work.

Done means the release candidate passes local production runtime checks, the preview reports the intended commit, and the deployed host passes catalog and critical shopping checks. New work cannot silently replace the 50-look database with old bundled snapshots. Paid checks, provider configuration checks, and physical-device checks have separate recorded results.

Use one release/CI owner plus the coordinator. Only one person publishes shared catalog repairs or the final release.

**10. Finish the existing clip-input PR behind a verified feature flag**

[PR #26](https://github.com/ohong/halloween-supply/pull/26) already implements YouTube and short uploaded clips using the existing sourcing stream. Its body records successful checks on another Gemini model and a quota failure for the intended Argon model. That is an availability gap, not proof that the target model works today.

Rebase and review the shared-stream extraction against current screenshot behavior. Select an actually available model and report its identity. Preserve the current screenshot path, bounded inputs, partial results, and clear timeout errors. Put clip input behind an explicit availability flag until its provider tests pass.

Choose the existing PR over rewriting clip ingestion or adding arbitrary video download support. Its narrow inputs offer most of the value with less operational work.

Done means one current real YouTube run and one short synthetic upload produce a usable product board. Their actual model, time to first result, completion time, and missing pieces are recorded. If account quota blocks either run, keep the feature disabled and deliver a reviewed branch with a precise blocker.

Give one owner a one-hour initial pass. The provider dependency makes this a conditional release item.

## Sixteen-agent allocation

| Agents | Ownership | Useful parallel work |
| --- | --- | --- |
| 1 | Coordinator and integration | Contracts, scope, conflict resolution, final publication |
| 2–5 | Catalog researchers | Separate costume evidence files for #1 and #3; one also validates combined evidence |
| 6 | Discovery UI | Kit cards, price filter, readiness summaries |
| 7 | Look-state backend | Selection representation, persistence, server-resolved product references |
| 8 | Look UI | Saved choices, sharing, screenshot/custom preview connection; owns `costume-experience.tsx` and `virtual-try-on.tsx` |
| 9 | Checkout and refresh | Drawer recovery, verification status, existing verifier protection |
| 10 | Camera | Relay adapter and phone connection diagnostics |
| 11 | Mirror | Existing voice path and selected unmerged control changes |
| 12 | Measurement | Event helper and summary; instrumentation inserted by feature owners |
| 13 | Release/CI | Existing script gates and current project guidance |
| 14 | Clip input | PR #26 and its focused provider checks |
| 15–16 | Independent QA | Shopping/state tests and media/device checks; repair confirmation |

The 16-agent ceiling provides 48 agent-hours over three hours. The plan deliberately reserves time for review and integration. More agents are useful for isolated merchant research or independent review after file ownership is settled. They do not make a single shared component or a blocked provider account progress faster.

Use one worktree per code owner and separate evidence files per researcher. Agree on the selection, kit-evidence, and event contracts before dependent edits. Shared catalog records, checkout, global CSS, and central types have one writer each. Other lanes request focused integration changes.

## Three-hour schedule

1. **Minutes 0–20:** Confirm the release base and baseline health. Preserve dirty work. Assign ten priority costumes. Freeze small selection, kit-evidence, and event contracts. QA records the existing core journeys.
2. **Minutes 20–90:** Run independent research and implementation. Integrate completed low-risk changes continuously. Camera and clip owners resolve external dependencies early. Require the saved-reference proof for #4 by minute 45.
3. **Minutes 90–120:** Stop adding scope. Combine evidence, publish one validated kit set, and run the integrated preview. Reassign blocked-lane agents to review or verification.
4. **Minutes 120–165:** Run real shopping and bounded provider checks. Review actual preview output. Fix regressions through their assigned owners. Physical-device results require a real device and available tester.
5. **Minutes 165–180:** Ship the passing release through the normal deployment path. Verify its commit, all 50 catalog pages, the changed shopping paths, and resource cleanup. Record exact remaining blockers.

Target #1, #2, #3, #5, #8, and #9 for the core release. Aim for ten kits, but publish the verified subset if sourcing evidence is incomplete. Treat #4, #6, #7, and #10 as bounded lanes that must earn inclusion through runtime evidence. A useful campaign can ship six strong improvements while leaving a reviewed, accurately reported result from every other lane.

## Open-loop disposition and deferred work

| Existing loop | Recommended disposition |
| --- | --- |
| Fifty fully shoppable looks | Completed today. Preserve PR #32 and rerun targeted release checks after changes |
| Broader merchant sourcing | Reconcile and ship the accepted local policy through #1/#9; Amazon itself is already allowed |
| Phone relay and Cloudflare activation | Handle through #6; verify current credentials and provider before another activation effort |
| Six local mirror commits | Selectively evaluate through #7; preserve current production fixes |
| [Gemini Live PR #25](https://github.com/ohong/halloween-supply/pull/25) | Defer default-provider migration. Its recorded gaps include real microphone, live camera, interruption, longer-session, and Safari behavior |
| [Clip PR #26](https://github.com/ohong/halloween-supply/pull/26) | Bounded completion lane #10 |
| [Competition docs PR #27](https://github.com/ohong/halloween-supply/pull/27) | Coordinator reconciles stale evidence claims and links. Preserve the distinction between measured stock OpenCV results and unverified COOL claims |
| Agent-readable pages and metadata | Already shipped. Keep their existing checks; prioritize useful discovery and sharing before another score exercise |
| Video submission | The user said they will submit it separately. Do not treat the missing report URL as an implementation defect |

Defer another bulk catalog expansion, another mirror redesign, an image-model migration, and further 3D polish during this campaign. They offer less immediate completion value than the ranked work.

Post-payment order automation was explicitly outside v1. Stripe remains in test mode. A durable paid-order handoff, fulfillment visibility, and shipping economics belong before a real-money launch; they are a separate scope decision. This review establishes no completed payment or fulfilled-order evidence.

No new verified Next.js issue arose during this review. The prior HTML `Vary` issue already has a feedback draft in the related chat. No duplicate report is needed for this advisory pass.
