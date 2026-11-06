# Open loops — November 5 campaign

Updated November 6, 2026.

This file separates prior work, campaign work, and external dependencies.
The ten-item implementation and verification states are in the
[campaign ledger](README.md). The stack merged on November 6 and production serves
`311a8f7`. The [production report](../../verification/production-2026-11-06.md)
records exact checks and preserves the external limits.

| Loop | Observed state | Disposition and remaining evidence |
| --- | --- | --- |
| 50 shoppable catalogs, PR #32 | Included in baseline `2062f16`; retained in production `311a8f7`. | Hosted verification passed for all 50 catalogs, 556 images, 100 model assets, and 12 shopping groups. Stock freshness remains separate. |
| Broad retailer policy | Accepted decision integrated in #33 and deployed in `311a8f7`; the original dirty checkout is preserved. | Safe URL and live merchant checks remain. One actual merchant checkout passed; this does not qualify every retailer. |
| Linen Ghost completion kit | Hosted catalog marks selected sheet `p-734febc080` out of stock. | Application and purchase correctly block. Confirm this offer or research a replacement before claiming ten ready kits. |
| Stored merchant facts | Hosted health reports 62 stale products, six unknown-stock records, and 14 recorded out of stock. | Investigate affected merchant refreshes. No bulk refresh or catalog mutation ran during release verification. |
| Saved/shared selection and personal preview | Hosted fresh-browser restoration, exact cart pruning, repair gates, and 17 configured boundary checks passed. Earlier signed synthetic persistence is separately recorded. | A valid hosted curated photo returned provider 429. Fresh hosted saved-board persistence was not retested because production DB identity was not confirmed for deterministic cleanup. Successful retry and saved preview fidelity remain open. |
| Phone relay and physical iPhone/Safari | Item #6 retains Metered and passed synthetic direct/recovery/cleanup checks, including incomplete-config fallback. Neither TURN provider has available credentials. | Forced relay, physical iPhone/Safari, separate networks, cellular handoff, and phone live inference remain unverified. Do not infer relay use from credential metadata. |
| Mirror local-only commits | Reconciled in #35. Production Lucy transport decoded 1280×720 video; synthetic media and all connections closed. | One real typed command returned 503 requiring account credit. No paired command latency or garment/identity fidelity claim. Removed hourly quotas stay removed. |
| Gemini Live voice PR #25 | A separate provider migration from the existing voice path. | Defer default migration. Real microphone, interruption, long-session, camera, and Safari checks need their own evidence. |
| Clip input PR #26 | Item #10 implements a narrow gated path in `7243600`; it preserves the newer screenshot route. | Default off. Actual video probes returned 503 busy (`gemini-3.8-flash`), 404 unavailable (`gemini-2.5-flash`), and 429 quota (`gemini-4-argon`). Full YouTube/upload sourcing remains blocked on a qualified model. |
| OpenCV competition docs PR #27 | GitHub reports OPEN on `oh-cv-docs`, targeting `main`; checked November 5. | Do not merge the old report wholesale. Reconcile it against current routes and recorded stock-service evidence in a separate change. |
| COOL deployment and benchmark | No current COOL deployment or comparison was verified by this campaign. | Keep claims unverified. Require build evidence and a reproducible measured comparison before claiming a COOL speed advantage. |
| Competition video | The user owns the separate video submission. | A missing report video URL is not an application defect or permission to submit. |
| Agent-readable guides and metadata | Already present in the baseline with dated verification records. | Preserve and include relevant regressions in release checks. Do not claim an external score was rerun. |
| Real-money fulfillment | Guest checkout and manual concierge fulfillment remain the product model. | Before real-money launch, define durable paid-order handoff, fulfillment visibility, stock repair/refunds, and shipping economics. |
| Unpaid Stripe test session | Closed for one hosted case: a $10 USD pinned merchant offer created one unpaid TEST session, which was verified and expired. | This establishes one actual checkout, not every merchant, full-kit checkout, payment, or fulfillment. A separate merchant currency preflight failed before POST. |
| Hosted release verification | Closed for application commit `311a8f7`: exact Vercel deployment/domain, main CI, all-50 catalog/model checks, and 12 browser groups passed. | Runtime/provider, hardware, persistence, freshness, and log-retention limits remain explicit in the production report. |

## Competition report reconciliation

`gh pr view 27` returned an open PR on November 5. Its last reported update was
October 27. The report source on `oh-cv-docs` describes OpenCV as the default and
sole image reader. Current source instead defaults to Luna and uses OpenCV as an
optional supplement with a documented fallback. Those statements cannot both
describe the current product.

The report also contains a claimed COOL/Graviton deployment, planned benchmark
cells, and infrastructure links that are not present in the campaign baseline.
Its own PR body says the OpenCV evaluation, retry trace, and COOL benchmark were
still open. Later stock-service measurements and retry evidence exist in
[screenshot sourcing](../../screenshot-sourcing.md). They are dated evidence,
not a new COOL result.

The safe disposition is to preserve the old report branch and rewrite its claims
against current source in a separate review. Keep measured stock results,
unverified COOL work, and the user-owned video submission distinct. The campaign
does not merge PR #27 or publish a competition submission.
