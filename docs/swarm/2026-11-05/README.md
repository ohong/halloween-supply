# November 5, 2026 campaign evidence

This ledger tracks the ten approved product improvements. The
[original review](original-review.md) was prepared October 27. Its live observations
and proposed schedule are historical. The current date is November 5; event notes
apply to the shopper's event date.

The integration baseline is `2062f165f397ff8d8a9cf5fbeb908e0561e9068b`
(PR #32). Work uses isolated branches. The existing dirty checkout and its accepted
merchant policy changes remain separate inputs to integration.

## Status meanings

- **Implemented:** the owner completed the source change. This alone does not
  establish integration, deployment, or provider success.
- **Verified:** a recorded check passed in the named runtime and scope.
- **Blocked:** a named external dependency or failed check prevents the remaining
  success condition. A bounded source change can still be implemented.
- **Pending:** the owner has not supplied final evidence yet.

## Ten-item ledger

| # | Improvement | Implementation | Verification | Remaining condition |
| --- | --- | --- | --- | --- |
| 1 | Completion kits and price-aware discovery | Pending owner evidence | Pending | Validate kit evidence, displayed subtotal, and cart agreement. |
| 2 | Complete saved/shared selections | Pending owner evidence | Pending | Fresh-browser restoration; no private sizes in public links. |
| 3 | Event and assembly readiness | Pending owner evidence | Pending | Check sources, assembly notes, and uncertain arrival for each kit. |
| 4 | Saved-board personal preview | Pending owner evidence | Pending | Real saved-board continuity, retry, selected-product preview, and curated regression check. |
| 5 | Checkout recovery and freshness | Pending owner evidence | Pending | Invalid size, merchant failure, replacement, price acceptance, and expired unpaid test session. |
| 6 | Phone camera connection | Pending owner evidence | Pending | Forced relay and physical phone on a separate network remain separate gates. |
| 7 | Mirror controls and timing | Pending owner evidence | Pending | Fixed commands, paired measurements, visible output, and resource cleanup. |
| 8 | Anonymous measurement | Pending owner evidence | Pending | Browser event sequence, consent signals, allowlisted payloads, and read-only summary. |
| 9 | Release base and checks | Baseline selected; integration pending | Pending | Local release checks, intended preview commit, hosted shopping checks. |
| 10 | Gated clip input | Pending owner evidence | Pending | One real supported YouTube input and one short upload; record actual model and quota state. |

No campaign verification result is implied by this initial ledger. Owners add
their evidence in separate files. The coordinator updates this table after reading
those results and checking integration.

## Verification record

Documentation inspection completed:

```sh
git log -5 --oneline
git worktree list
gh pr view 27 --json number,title,state,headRefName,baseRefName,mergeStateStatus,updatedAt,body,url
```

These checks confirmed the selected source baseline and the open competition-docs
PR. They do not verify the shopping runtime or any provider. The app's health
endpoint and historical evidence have separate scope.

Final owner evidence and integration checks are pending. See
[open loops](open-loops.md) for dependencies that require later action.
