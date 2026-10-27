# Agent loop eval (SCREENSHOT_VISION=opencv)

Generated 2026-10-27T00:22:19.428Z by `bun scripts/eval-agent.ts`. 25 images, 25 completed, 96 pieces.

| Outcome | Pieces | Share |
|---|---:|---:|
| Matched on first try | 32 | 33.3% |
| Matched after retry | 3 | 3.1% |
| Needs shopper approval | 7 | 7.3% |
| Unmatched | 54 | 56.3% |

Retry recovery rate: 12.5% of the 24 pieces the agent retried ended in an accepted match.

| Latency | p50 | p95 |
|---|---:|---:|
| Time to first match (ms) | 15090 | 29951 |
| Time to done (ms) | 28588 | 30125 |

11 of 25 runs hit the 30 s search budget.

## Retry and approval reasons

| Reason | Count |
|---|---:|
| no_candidates | 16 |
| approve:budget_low | 6 |
| color_mismatch | 6 |
| type_mismatch | 2 |
| approve:retries_exhausted | 1 |
| weak_score | 1 |

## Failed runs

None.

## Per image

| Image | First try | Retry | Approval | Unmatched | Done (ms) |
|---|---:|---:|---:|---:|---:|
| autumn-scarecrow | 0 | 0 | 0 | 5 | 30002 |
| candy-corn-sorceress | 0 | 0 | 0 | 6 | 30125 |
| celestial-sorcerer | 1 | 0 | 0 | 3 | 30006 |
| clockwork-aviator | 2 | 0 | 0 | 1 | 13803 |
| coral-mermaid | 0 | 0 | 1 | 2 | 30002 |
| cosmic-cowboy | 0 | 0 | 0 | 5 | 30003 |
| desert-alchemist | 0 | 0 | 0 | 5 | 30003 |
| disco-phantom | 0 | 0 | 1 | 2 | 30003 |
| enchanted-jester | 0 | 0 | 1 | 4 | 30042 |
| forest-sprite | 0 | 0 | 0 | 4 | 30002 |
| garden-beekeeper | 1 | 1 | 1 | 1 | 29576 |
| linen-ghost | 1 | 0 | 0 | 1 | 21667 |
| midnight-pirate | 3 | 0 | 0 | 2 | 24282 |
| moon-moth | 0 | 0 | 0 | 3 | 22684 |
| pumpkin-harlequin | 2 | 0 | 0 | 1 | 18625 |
| raven-scholar | 2 | 0 | 1 | 0 | 27157 |
| retro-astronaut | 4 | 0 | 0 | 1 | 9083 |
| rose-garden-queen | 2 | 0 | 0 | 1 | 30002 |
| snow-owl | 1 | 1 | 0 | 1 | 27229 |
| starlight-witch | 2 | 0 | 1 | 1 | 24005 |
| storm-chaser | 2 | 1 | 0 | 0 | 28588 |
| velvet-ringmaster | 3 | 0 | 0 | 0 | 20134 |
| velvet-vampire | 2 | 0 | 0 | 2 | 13964 |
| victorian-detective | 3 | 0 | 1 | 0 | 28400 |
| woodland-mushroom | 1 | 0 | 0 | 3 | 30142 |

