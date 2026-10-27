# Scoring sweep for vision/app/scoring.py

Generated 2026-10-27T00:22:46.193Z by `bun scripts/eval-scoring.ts` from `eval/out/agent-runs.json`. This is a proposal only; scoring.py is unchanged.

139 scored candidates across 55 pieces, 115 labelled relevant. 0 labels come from Oscar's contact sheet (`eval/match-labels.json`); the other 139 are stand-in labels from the product title (same garment class as the piece, and no title color from a different family). Title labels are noisy, so treat the numbers as directional until the contact sheet is labelled and this is rerun.

A "match" here is the service's `match` verdict: score ≥ MATCH_MIN, ΔE ≤ COLOR_MISMATCH_DELTA_E and embedding ≥ TYPE_MISMATCH_EMBEDDING. Precision is relevant matches over all matches; recall is relevant matches over all relevant candidates.

| config | W emb / color / hist | MATCH_MIN | TYPE_MISMATCH_EMBEDDING | COLOR_MISMATCH_DELTA_E | precision | recall | F1 | tp/fp/fn |
|---|---|---|---|---|---|---|---|---|
| current | 0.55 / 0.3 / 0.15 | 0.6 | 0.68 | 25 | 85.0% | 59.1% | 0.697 | 68/12/47 |
| proposed | 0.55 / 0.45 / 0 | 0.45 | 0.6 | 20 | 86.8% | 86.1% | 0.865 | 99/15/16 |
| best F1 | 0.55 / 0.45 / 0 | 0.45 | 0.6 | 30 | 84.8% | 92.2% | 0.883 | 106/19/9 |

"Proposed" is the highest-precision config within 0.02 F1 of the best, nearest the current constants on ties. 36432 configs searched.

Base rate: 82.7% of scored candidates are labelled relevant, so a scorer that accepts everything already has that precision. Precision near the base rate means the gain comes from accepting more candidates (recall), not from ranking them better.

## One knob at a time (others at current values)

| TYPE_MISMATCH_EMBEDDING | precision | recall | F1 |
|---|---|---|---|
| 0.58 | 85.0% | 59.1% | 0.697 |
| 0.6 | 85.0% | 59.1% | 0.697 |
| 0.62 | 85.0% | 59.1% | 0.697 |
| 0.64 | 85.0% | 59.1% | 0.697 |
| 0.66 | 85.0% | 59.1% | 0.697 |
| 0.68 | 85.0% | 59.1% | 0.697 |
| 0.7 | 85.0% | 59.1% | 0.697 |
| 0.72 | 85.0% | 59.1% | 0.697 |

| MATCH_MIN | precision | recall | F1 |
|---|---|---|---|
| 0.45 | 83.9% | 81.7% | 0.828 |
| 0.5 | 83.0% | 76.5% | 0.796 |
| 0.55 | 84.1% | 64.3% | 0.729 |
| 0.6 | 85.0% | 59.1% | 0.697 |
| 0.65 | 83.9% | 45.2% | 0.588 |
| 0.7 | 83.3% | 30.4% | 0.446 |

| COLOR_MISMATCH_DELTA_E | precision | recall | F1 |
|---|---|---|---|
| 15 | 86.2% | 48.7% | 0.622 |
| 20 | 85.7% | 57.4% | 0.688 |
| 25 | 85.0% | 59.1% | 0.697 |
| 30 | 85.0% | 59.1% | 0.697 |
| 35 | 85.0% | 59.1% | 0.697 |
| 40 | 85.0% | 59.1% | 0.697 |

## Embedding similarity by label

| label | n | p25 | median | p75 |
|---|---|---|---|---|
| relevant | 115 | 0.739 | 0.802 | 0.842 |
| not relevant | 24 | 0.793 | 0.824 | 0.875 |
