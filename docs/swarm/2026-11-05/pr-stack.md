# Campaign review stack

The campaign uses three dependent review layers. Each layer addresses one
reviewable product boundary. The local branches below are prepared. PR URLs and
hosted results are recorded after creation; this document claims no merged PR.

```text
main
  |
  +-- codex/shopping-foundation
        |
        +-- codex/shopping-look-continuity
              |
              +-- codex/shopping-media
```

The campaign source baseline is `2062f165f397ff8d8a9cf5fbeb908e0561e9068b`.
The final PR bases and checked commits must be recorded after the stack is built.
Combined-branch verification does not prove that each reconstructed layer passes
independently.

| Layer | Branch | PR base | PR URL |
| --- | --- | --- | --- |
| Foundation | `codex/shopping-foundation` | `main` | Not recorded yet |
| Shopping look continuity | `codex/shopping-look-continuity` | `codex/shopping-foundation` | Not recorded yet |
| Media and current product docs | `codex/shopping-media` | `codex/shopping-look-continuity` | Not recorded yet |

## 1. Foundation

**Problem.** The old sourcing policy excludes accepted merchants. Cart failures
hide useful repair details. Catalog structure does not show merchant fact age.
There is no shared anonymous-event contract or credential-free release gate.

**Success conditions.** Approved retailers can supply valid product offers. A
failing cart line can be repaired without losing unrelated lines. Health separates
structure from stale or unknown merchant facts. Measurement excludes private
inputs. CI checks the bundled catalog without provider or payment work.

**Scope.** Broad retailer policy; typed cart recovery; fact freshness and refresh
summaries; allowlisted funnel ingestion and aggregate reporting; production smoke
checks and the quality workflow. The site's privacy disclosure ships with this
event collection, so the foundation describes the data it records.

**Evidence and limits.** Read [checkout recovery](../../checkout-recovery.md),
[measurement](measurement.md), and [release checks](release-checks.md). Controlled
checkout responses remain distinct from real merchant checks. Unpaid Stripe
sessions, production refresh writes, host retention, and hosted CI need their
own results. The foundation layer retains the 50-look storefront.

## 2. Shopping look continuity

**Problem.** Shoppers cannot compare a practical completion kit with a full
outfit. Saved links omit choices. Screenshot boards lose useful results, and
sourced boards lack a continuous path to personal preview.

**Success conditions.** The displayed kit subtotal agrees with its purchased
pieces. Owned basics, extra supplies, and arrival uncertainty are explicit. Shared
choices restore without private sizes. A repaired selection requires an explicit
decision before purchase. Saved boards retain found products and resolve preview
references on the server. Clip input remains hidden until a qualified model works.

**Scope.** Ten kit overlays and evidence; discovery prices and filters; destination
kit application; versioned save/share state; cart pruning and repair gates;
signed sourced-board persistence and per-row retry; saved-board photo preview;
default-off clip input.

**Evidence and limits.** Read [kits](kits.md), [discovery](discovery.md),
[saved state](../../verification/look-state-2026-11-05.md), [independent QA](qa.md),
and [clip sourcing](../../clip-sourcing.md). Product-name preview references do not
establish visual fidelity. OpenAI credit exhaustion blocks real generation and
missing-piece retry. Gemini video probes have not qualified a model.

Keep kit data, discovery links, and destination restoration in the same layer.
A separate discovery PR would expose kit links before the destination can apply
their owned and purchased choices. A single campaign PR would hide these shopping
changes among unrelated media work. This three-layer split preserves a coherent
shopping path while keeping review boundaries small.

## 3. Media and current product docs

**Problem.** Phone failures have unclear connection stages and weak recovery.
Mirror changes need selective reconciliation and measured timing boundaries.
Top-level product docs still describe retired architecture and an early v1.

**Success conditions.** Phone failures identify their stage, retain an existing
source during brief recovery, and release late or stopped media. Mirror actions
preserve unrelated choices and reject stale responses. Timing distinguishes state,
provider send, and transport frames. Documentation matches the complete stack
and reports provider, physical-device, and deployment limits.

**Scope.** Existing Metered relay adapter diagnostics, direct fallback, bounded
phone recovery, permission/lens cleanup; atomic mirror controls and transport
timing; current README, brief, task list, campaign evidence, and
open-loop disposition. The runtime privacy disclosure belongs to foundation;
this layer carries the remaining product documentation.

**Evidence and limits.** Read [phone camera](../../phone-camera.md),
[mirror evidence](../../mirror-control-evidence.md), and [open loops](open-loops.md).
Synthetic Chromium and real Lucy transport do not prove physical iPhone, forced
relay, garment fidelity, or real voice accuracy. No hourly demo quota is restored.
COOL deployment/performance and the user-owned video submission remain separate.

## Final verification

The [campaign ledger](README.md) records exact commands and observed results.
After creating the stack, run the required checks on each actual PR head and
record hosted CI separately. New production deployment, payment, fulfillment,
physical-device, and provider-success claims require their own evidence.
