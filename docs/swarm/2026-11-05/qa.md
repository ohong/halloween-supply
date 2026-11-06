# Independent campaign QA

Status: the final patched local production app passed all 12 campaign groups, including the purchase repair gate.

The suite uses the real local production app and bundled catalog. It does not create provider generations or payment sessions.

Two approaches were considered. Live provider and merchant checks give broader external evidence, but require current service access and may charge money. Browser interaction checks with one bounded checkout response fixture isolate the changed cart behavior. This campaign uses the second approach and reports external checks separately.

The CI owner covers all 50 catalog pages, served catalog images, model assets, and basic saved/cart flows. This independent suite covers the new campaign contracts: kit/price discovery, complete saved selections, sharing, owned/skipped pieces, cart recovery, saved-board trust boundaries, and invalid media inputs.

Full campaign command:

```sh
SHOPPING_EVIDENCE_DIR=/tmp/halloween-shopping-campaign-patched-final bun scripts/verify-shopping-campaign.mjs http://localhost:3340
```

Screenshots and the JSON summary are written outside the checkout. Each check records its actual result. Source review and browser response fixtures are labeled separately from live provider evidence.

The summary is `/tmp/halloween-shopping-campaign-patched-final/summary.json`. The run used the local production server with bundled catalog fallback and no database or OpenAI keys. It created no payment sessions or provider generations. The integration checkout was at `ce8f4c4cace862b6aa34718eb349e739a3dbc7cb` during this run. Scoped ESLint and JavaScript syntax checks passed for the QA script.

All ten kit links applied their exact listed purchases. Their cart totals ranged from $13.50 to $98.39. Owned/skipped states and readiness labels agreed with each kit. The date control accepted December 31, 2026, while delivery remained explicitly unconfirmed. Discovery returned 11 looks under $100 and retained search, Saved, and male presentation together.

The shared customized look restored a swapped product, one owned required piece, one skipped optional piece, an imported cape, male presentation, and a labeled preview edit. A fresh browser charged exactly three selected products, totaling $150.18. A separate existing-cart case removed owned/skipped lines, reducing five charged lines to three.

Corrupt, retired, and incomplete snapshots showed repair notices and blocked whole-costume purchase. The corrupt snapshot blocked sharing. The incomplete snapshot also blocked piece use, dialog purchase, and inspector purchase. Choosing “Use available picks” explicitly enabled the repaired selection.

The cart response fixture exposed a new offered size, kept four unrelated lines through a merchant failure, applied an alternative, and required explicit acceptance of a changed price. Four intercepted checkout requests occurred. This verifies browser recovery behavior; it does not verify a live merchant or Stripe session.

The browser emitted 53 anonymous events across 14 browser journeys. The observed names were view, filter, kit, cart_add, checkout_start, and checkout_recovery. Each context kept one journey identifier. Payload keys stayed within the fixed allowlist. No browser context reported an uncaught runtime error.

Unsigned saved products returned 400. Six unsafe URL forms returned 400. A forged proof returned 503 because the production test server had no signing credential. This is fail-closed configuration behavior; it is not evidence of configured signature verification. The backend owner separately tested signed records against configured storage and cleaned up its synthetic record.

Seven invalid preview requests failed before providers. The clip availability endpoint reported disabled, and clip POST returned 503. Phone relay, physical-device media, actual screenshot sourcing, generated personal preview fidelity, and live checkout are outside this QA run.

Screenshots include `discovery-desktop.png`, `discovery-mobile.png`, `selection-mobile.png`, `shared-selection-cart.png`, `kit-exact-cart.png`, and `cart-recovery-fixtures.png` within the evidence directory. The phone and desktop cart artifacts were visually inspected. Mobile overflow checks passed at 390 pixels.

No new verified Next.js issue was retained in this QA lane.

Observed checks:

| Check | Result | Evidence |
| --- | --- | --- |
| Valid anonymous demonstration event | HTTP 204 | `/tmp/halloween-shopping-qa-events/summary.json` |
| Raw query/photo fields | Both HTTP 400 | Same summary |
| Missing or foreign Origin | Both HTTP 403 | Same summary |
| Do Not Track header | HTTP 204 without payload validation or recording | Same summary and route inspection |
| Cart browser subsection on development server | Not run: connection refused after the server stopped | `/tmp/halloween-shopping-qa-cart/summary.json` |

The event command was `SHOPPING_EVIDENCE_DIR=/tmp/halloween-shopping-qa-events bun scripts/verify-shopping-campaign.mjs http://127.0.0.1:3340 --only=event`.

Source review found an existing-cart edge case in the new selection flow. Restoring owned/skipped choices updated the page, but adding the look merged old excluded cart lines. The UI owner fixed whole-look addition to remove excluded lines first. The dedicated browser case passed on the integrated build.

Saved product trust review found server-signed product receipts, exact saved product resolution, public HTTPS URL validation, and text-only references for sourced products. The preview path does not fetch client-supplied merchant photos. Runtime rejection results are recorded above. No accepted QA finding remains open.
