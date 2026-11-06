# Checkout recovery and catalog facts

Checkout failures identify the exact cart piece and product. The drawer focuses
that line and offers a specific repair. A removed size shows the merchant's
offered labels. Choosing one updates only that line. Sold-out and unverified
products show other recorded picks for the same catalog piece.

Replacing a pick keeps the cart's costume and unrelated lines. Alternative
merchant links come from the published catalog. Comparison links resolve the
piece's real source costume, including pieces mixed into another look. Saved
custom and screenshot pieces have no invented catalog alternatives. They can
be retried or removed while keeping the rest of the cart.

The shopper must explicitly accept changed prices. That acceptance remains for
unchanged products during recovery in the current page. Replacement products
do not inherit it. Every retry still verifies merchant stock, size, currency,
variant and exact price. No stored fact bypasses checkout verification.

## Fact freshness

`/api/health` keeps catalog structure and merchant facts separate. Each catalog
and the combined live catalog expose `facts` or `catalogFacts` with:

- Product counts with fresh, stale, or missing/invalid confirmation timestamps.
- The oldest and newest confirmation times.
- Separate in-stock, sold-out, and unknown-stock counts.

A stored fact becomes stale after 36 hours. This gives the daily refresh a
12-hour allowance. Future timestamps beyond one minute count as invalid.
Complete catalog structure can still have stale facts or unknown stock. Those
conditions make the overall health status `degraded`. HTTP 503 remains reserved
for incomplete catalog structure; clients must inspect the fact fields too.

Refresh responses include start and finish times, duration, status, verified
and unverified counts, unknown-stock attempts, and fact summaries before and
after the run. The after-summary comes from a database read. Failed merchant
checks do not overwrite stored prices, stock, sizes, or confirmation times.

Run summaries are returned to the caller and are not persisted. Health exposes
`refreshHistory.persisted: false` and `lastRun: null`. There is no new table or
service. Product timestamps describe confirmed facts, not the last attempted
refresh. Successful cron writes still expire the catalog cache immediately.

## Verification

Run a local app, then run:

```sh
node scripts/verify-checkout-recovery.mjs http://127.0.0.1:3415 --merchant
```

The browser portion controls checkout responses to exercise uncommon failure
branches. It verifies phone and desktop recovery, exact-line focus, same-piece
replacement, cart preservation, live size labels, reload persistence, and price
acceptance across retries. These fixtures do not prove current merchant stock.

The `--merchant` portion sends a real invalid size through the real checkout
API for the Cosmic Cowboy fringe jacket mixed into a Vampire cart. It requires
merchant-offered size labels and source-correct catalog alternatives. It cannot
create a session because size verification fails first.

The November 5 checks passed focused lint, route type generation and TypeScript.
The browser and real merchant checks passed. No Stripe session, payment, or
production database mutation occurred. The main checkout's local environment
contained a Stripe test key when inspected. This is configuration evidence;
an unpaid Stripe session was not verified during this pass. Authorized refresh
success and database write paths were not exercised against production.
