# Catalog-wide GPT Live shopping

The mirror can search every published database costume and its merchant options,
regardless of the page where the conversation starts. Guest-created, unlisted
looks are not public inventory.

## Design

Sending the entire inventory through each live context update would increase
latency and exceed Live's 500-token append limit. Instead:

1. Session creation reads the complete catalog once and supplies a costume/piece index.
2. Native Decisions handles fast outfit controls and identifies catalog questions.
3. Catalog questions reach a reasoning backend with **all** database inventory:
   every piece, product description, merchant, price, size, stock fact, timestamp,
   styling note, source evidence and price tier. There is no current-costume filter.
4. The server resolves model-selected keys to real catalog records. The interface
   receives merchant photos, purchase links and associated costumes.
5. Live receives concise verified results after the updated context is accepted.

Searches and comparisons are read-only. An explicit “try the second result” or
“use the shiny pair” now mixes that product into the current outfit. The result
card offers **Add to outfit**. A complete costume switch requires an explicit
whole-look request. The backend matches meaning, function, price, descriptions,
and ordered results; it asks when a reference remains ambiguous.

Mixed outfits retain real source costume/piece/product references plus the original
slot being replaced. The server resolves them again when applying an edit, starting
Live, building a video reference, restoring a shared link, and checking out. It never
accepts model-generated product details or prices. Matching garments replace slots;
new accessories append optional slots. Locked slots reject replacements. Undo
restores both the prior outfit and its piece definitions. Added optional pieces can
be skipped by voice. At most twelve imported pieces and twenty total slots are allowed.

The original costume stays selected, and every unrelated selection stays in place.
Subtotal, merchant links, the flat-lay, photo styling, and the shopping page use the
composed outfit. Existing cart lines follow swaps as they already do for local edits;
adding a piece to an outfit does not start checkout or place an order.
Previous result references are revalidated against fresh catalog data.
Outdated voice results are discarded after manual outfit or search changes.

The costume picker also reads database metadata. If the database is unavailable,
the existing bundled catalog fallback is labelled as the result source.

## Verification

`bun scripts/verify-mirror-catalog.ts http://localhost:3412` checks the real
database index, origin validation and forged-reference rejection.

Add `--live` to run real Decisions and reasoning requests. It checks that a
vampire-page search finds silver boots from other costumes without applying
edits, then resolves “try the second result” to the exact source product while
keeping the current costume. It applies the edit through the real mix endpoint,
checks locked/forged references, adds pirate headwear by meaning without an exact
product name, restores mixed references, and builds a real mixed preview board.

Browser checks cover result cards, preserving the current look during search,
cross-costume swaps, undo, the shopping handoff, and a Live WebRTC connection without microphone capture.
Real microphone playback remains a separate manual acceptance check.

API behavior follows [native Decisions delegation](https://developers.openai.com/api/docs/guides/decisions-voice)
and [Live context updates](https://developers.openai.com/api/docs/guides/live-delegation#send-the-right-kind-of-update).
