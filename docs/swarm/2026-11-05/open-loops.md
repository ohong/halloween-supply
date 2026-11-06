# Open loops — November 5, 2026

This file separates prior work, campaign work, and external dependencies.
The ten-item implementation and verification states are in the
[campaign ledger](README.md). No item here establishes a new deployment.

| Loop | Observed state | Disposition and remaining evidence |
| --- | --- | --- |
| 50 shoppable catalogs, PR #32 | Included in baseline `2062f16`. | Preserve all 50. Rerun catalog and critical shopping checks after integration. |
| Broad retailer policy | Accepted user decision; existing dirty patch is separate from the campaign branches. | Integrated by the coordinator in `09913e2`. Preserve safe URLs and current merchant checks. Deployment remains unverified. |
| Saved/shared selection and personal preview | Campaign items #2 and #4. | Record restoration, partial retry, selected-product preview, and curated regression evidence. Sizes and photos stay out of public links. |
| Phone relay and physical iPhone/Safari | Historical notes describe successful synthetic direct connection and unresolved relay/device checks. | Item #6 records the active adapter, credential result, forced-relay test, separate-network physical-device result, and cleanup. Do not infer relay success from configuration. |
| Mirror local-only commits | Prior changes diverge from the repaired catalog baseline. | Item #7 selectively reconciles controls and measures state/send/frame stages. Preserve newer fixes and removed hourly quotas. |
| Gemini Live voice PR #25 | A separate provider migration from the existing voice path. | Defer default migration. Real microphone, interruption, long-session, camera, and Safari checks need their own evidence. |
| Clip input PR #26 | Conditional campaign item #10. | Keep the feature off by default until real YouTube and upload checks pass on an available, named model. A quota error does not verify that model. |
| OpenCV competition docs PR #27 | GitHub reports OPEN on `oh-cv-docs`, targeting `main`; checked November 5. | Do not merge the old report wholesale. Reconcile it against current routes and recorded stock-service evidence in a separate change. |
| COOL deployment and benchmark | No current COOL deployment or comparison was verified by this campaign. | Keep claims unverified. Require build evidence and a reproducible measured comparison before claiming a COOL speed advantage. |
| Competition video | The user owns the separate video submission. | A missing report video URL is not an application defect or permission to submit. |
| Agent-readable guides and metadata | Already present in the baseline with dated verification records. | Preserve and include relevant regressions in release checks. Do not claim an external score was rerun. |
| Real-money fulfillment | Guest checkout and manual concierge fulfillment remain the product model. | Before real-money launch, define durable paid-order handoff, fulfillment visibility, stock repair/refunds, and shipping economics. |
| Hosted release verification | Campaign source work and local verification are separate from release. | After authorized deployment, confirm the exact commit and run hosted catalog and shopping checks. |

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
