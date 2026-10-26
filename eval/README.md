# Screenshot sourcing eval

This folder measures the two halves of screenshot sourcing on the 25 catalog editorial images: how well the image is decomposed into garment pieces, and how well the agent loop turns each piece into a product. The COOL benchmark lives in `vision/bench/`.

## Files

- `fixtures/editorial/*.jpg` are the 25 catalog editorial images. The source PNGs have transparent backgrounds, so `scripts/eval-prepare.py` flattens them onto white and saves JPEGs, which is what a shopper's screenshot looks like.
- `ground-truth.json` lists 120 components (slot, garment phrase, color) across the 25 costumes. We drafted it from the catalog entries and checked it against the images.
- `synonyms.json` holds the matching vocabulary: slot groups (top and outer are interchangeable), color families, garment classes and which classes count as compatible.
- `out/decompose.md` and `out/agent.md` are the generated reports. `out/decompose-*.json` and `out/agent-runs.json` cache the raw responses, so `--rescore` rebuilds a report without calling any service.
- `out/contact-sheet.html` shows each piece crop next to the product the agent chose, with its scores. Label each row accept or reject, press the download button, and save the file as `eval/match-labels.json`. The next `eval-agent.ts --rescore` adds the acceptance rate to `agent.md`.

## Reproduce

Decomposition (OpenCV service vs luna):

```bash
VISION_SERVICE_URL=http://localhost:8080 VISION_SERVICE_TOKEN=... bun --env-file=.env.local scripts/eval-decompose.ts --pipeline both
```

Agent loop. Start the Next server with `SCREENSHOT_VISION=opencv`, `VISION_SERVICE_URL`, `VISION_SERVICE_TOKEN` and `FIRECRAWL_API_KEY` set, then:

```bash
bun scripts/eval-agent.ts --base http://localhost:3000
```

Re-score from the cache after editing `synonyms.json` or adding labels:

```bash
bun scripts/eval-decompose.ts --pipeline both --rescore
```

```bash
bun scripts/eval-agent.ts --rescore
```

## How scoring works

A predicted piece matches a ground-truth component when its slot falls in the same slot group and its garment phrase is similar enough: the same head noun scores 1, the same garment class 0.75 and a compatible class 0.5, and the threshold is 0.5. Pairs are assigned greedily one to one, highest similarity first. Precision is matched predictions over all predictions, and recall is matched components over all components. Color accuracy counts a matched prediction whose dominant color name falls in the ground-truth color family. For luna, which returns no color field, the color is the first color word in its query.

The agent eval reads the route's NDJSON stream. A piece is a first-try match when the agent accepted a product without retrying, retry-recovered when it accepted after at least one retry, needs-approval when the agent handed the choice to the shopper, and unmatched otherwise.

## Limitations

- The images are generated editorial renders on clean backgrounds, not real screenshots with clutter, crops and UI chrome. Real screenshots will score lower.
- 25 images and 120 components are enough to compare pipelines, not to quote tight confidence intervals. One costume moves recall by about 0.8 points.
- We drafted the ground truth ourselves, and some colors are honestly ambiguous (plum vs burgundy, gold vs mustard). We did not adjust the ground truth to fit either pipeline, so ambiguous cases show up as color misses.
- Garment matching uses a hand-written synonym list, so it is approximate. A correct but unusual phrase can count as a miss, and a loose class match can count as a hit.
- Agent results depend on live search results and merchant pages at run time, so two runs on the same image can choose different products.
