# Saved look state and sourced-board persistence

The backend preserves shopping choices in a versioned public snapshot. Private sizes remain in browser storage. Saved sourced boards reuse `custom_looks`; source screenshots, personal photos and generated previews are excluded.

## Design choice

Two approaches were considered. Accounts and cloud photo storage could synchronize every device, but would add authentication and a new photo lifecycle. A versioned local snapshot and a public shopping link preserve the current guest workflow with smaller changes. The implementation uses the latter.

The existing curated preview route accepts its original fields. A saved board supplies `savedLookId` instead of `costumeSlug`. The server reads the saved record and rejects client product IDs that differ. Saved boards currently supply product names as text references. They do not fetch merchant images or upload source screenshots. These previews remain approximate; visual product fidelity has not been demonstrated.

Screenshot and clip item events carry an HMAC receipt. The save route verifies each receipt before accepting product fields. The receipt key derives from `SAVED_LOOK_SIGNING_SECRET`, or the existing server-only Turso credential. Development without a stable credential uses a process key; its receipts expire when that process restarts. Production requires a stable secret. Receipt payloads always normalize private sizes to `null`.

The private random `requestId` lets the browser update its screenshot board while keeping the public look ID stable. Public GET responses omit this edit capability. A missing-piece retry creates a separate saved copy and retains all other rows. Repeating the retry request ID reopens its saved result rather than repeating paid work.

## Validation run

`bun scripts/verify-look-state.ts http://localhost:3342` passed four feature groups against a real local Next route and bundled catalog data:

- A swapped product, an owned required piece, a skipped optional piece, a mix, model preference and preview edits round-trip through a link. The restored merchandise subtotal equals the selected products.
- Private sizes stay local. Unsupported versions, malformed links and retired products produce repair information. Existing URL fields remain readable.
- Private, local, credentialed, non-HTTPS and noise product URLs fail validation.
- The real persistence route rejects unsigned, tampered and unsafe products before a database write.

The authorized persistence run used `SAVED_LOOK_PERSISTENCE_E2E=1` and existing server credentials. All seven feature groups passed. One synthetic nonpersonal record was created through the real HTTP route. A repeated request updated that same record. A fresh GET returned the same found item and missing row, with no chosen size or photo data. The actual preview-reference resolver read the product title from that persisted record. The photo route rejected an invented saved product and a mixed saved/curated source before provider access. A retry of an already-found row returned HTTP 400.

Cleanup deleted only the exact test primary key and its private request ID. A separate SELECT confirmed that record was absent. No catalog row or existing saved look was changed. The fixture supplied a signed synthetic sourcing result; this run does not establish live screenshot matching or merchant facts.

`next typegen`, `tsc --noEmit`, focused ESLint and `git diff --check` passed. No full build was run in this lane; integration owns that check.

## Limits

No paid sourcing or image generation ran. Another campaign lane confirmed that the existing OpenAI account returns HTTP 429 for exhausted credit. This lane did not repeat that request. Missing-piece retry provider success and visual preview fidelity remain unverified. Browser interaction and integrated cart continuity belong to the UI and independent QA lanes.

Next Turbopack could not resolve the shared `node_modules` symlink outside this isolated worktree. The scoped server used `next dev --webpack`, and its real routes worked. No framework configuration was changed for that workaround.
