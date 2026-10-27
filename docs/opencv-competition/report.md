# halloween.supply: OpenCV 5 perception for an agent that shops a screenshot

halloween.supply turns a photo of a costume into a cart of real products from independent merchants. For this entry we replaced the language-model vision calls in that flow with an OpenCV 5 service on AWS Graviton (built with COOL), and wrapped it in an agent loop where OpenCV's match measurements decide whether to accept a product, search again with a corrected query, or ask the shopper. Every step emits a trace the shopper can see.

- Live: https://halloween.supply/screenshot
- Diagrams: [architecture](architecture.svg), [agent loop](agent-workflow.svg)
- Reproduce: [reproduce.md](reproduce.md) · Responsible use: [responsible-use.md](responsible-use.md)
- Featured paths claimed: **Agentic Vision** (section 7) and **Best Use of COOL** (section 6)

## 1. Problem

Costume ideas arrive as pictures: a film still, a friend's party photo, a Pinterest pin. Buying one means working out which garments make up the look, what each is called in a shop, which colors matter, and then checking dozens of product photos to see whether they are the same thing. A person does that by eye. Our previous version did it with two calls to a multimodal language model, one to list the garments and one to judge the product photos (`decomposeScreenshot` and `reviewScreenshotProducts` in `lib/sourcing/screenshot-vision.ts` on `main`). That worked, but it produced judgments without measurements: when it accepted a red hat for a brown one we could not see why, and the system had nothing to act on except a yes or no.

The problem we set out to solve is to make perception measurable, so that the agent can read what was wrong with a candidate (wrong color, wrong garment type, no garment in the photo) and change its next search because of it.

## 2. Users

The shopper is an adult buying a Halloween costume, usually on a phone, a few days before an event. They want something that looks like the picture and arrives in time; they do not want to learn garment vocabulary or open thirty merchant tabs. They need to trust the result, which is why the system shows its evidence and asks before using a weak match.

The second user is the store operator, who fulfils orders manually across merchants. For them the trace is an audit log: it shows which query found each product and how well it scored.

## 3. Architecture

![Architecture](architecture.svg)

The shopper uploads a screenshot to `/api/screenshot-costume` on Vercel. The route re-encodes it (EXIF stripped, at most 1024 px), sends it to the vision service through CloudFront as base64 inside a JSON body, and gets back the person's garments. For each garment it searches merchants (Firecrawl web and image search), fetches the product photos, and sends those bytes to the vision service to be scored. The agent loop decides what to do with the scores, and the route streams NDJSON events back to the browser as it goes, so matches appear before the whole request finishes. Search has a 30 s budget (`SEARCH_BUDGET_MS`), unchanged from the previous version, inside a 40 s function limit (`maxDuration`).

The interface between the two halves is a small JSON API with two endpoints, `/v1/analyze` and `/v1/match`, plus `/healthz`. The service never fetches URLs, so it cannot be turned against internal addresses, and every response carries an `X-OpenCV-Build` header naming the OpenCV version and build. The storefront's side of the contract is [`lib/sourcing/vision-client.ts`](../../lib/sourcing/vision-client.ts): `/v1/analyze` takes `{image_b64, max_pieces: 8}`, and `/v1/match` takes one piece (region, colors, embedding, garment phrase) and its candidate photos as `{id, image_b64}`, with an 8 s timeout. The route reports the build to the browser as `X-Vision-Model: opencv-5:<build>`. The service side is [`vision/app/main.py`](../../vision/app/main.py): it refuses to start without `VISION_SERVICE_TOKEN`, checks the bearer token with a constant-time compare, rejects images over 4 MB decoded (413) and more than 12 candidates per match (413), and turns undecodable images into a 400.

Mode is a single environment variable: `SCREENSHOT_VISION=opencv` (default) or `luna` (the old path, kept for the comparison in section 8). With `opencv` selected, the route returns 503 instead of falling back silently when the service URL or token is missing, or when `/healthz` does not answer within 3 s; any other mode value is also a 503 ([`route.ts`](../../app/api/screenshot-costume/route.ts), [`vision-client.ts`](../../lib/sourcing/vision-client.ts)). OpenCV mode needs only the Firecrawl key and the service URL and token; the OpenAI key is needed only for `luna`.

## 4. OpenCV 5 implementation

All image analysis in the service runs through OpenCV 5. Neural networks are loaded with `cv2.dnn` from ONNX files; there is no PyTorch, onnxruntime or transformers at runtime. The service's only runtime dependencies are FastAPI, uvicorn, numpy and `opencv-python-headless==5.0.0.93` ([`vision/pyproject.toml`](../../vision/pyproject.toml), locked in `vision/uv.lock`).

**Analyze** (`POST /v1/analyze`) runs this pipeline on one screenshot:

1. **Segment.** A SegFormer-B2 clothes-parsing model (`mattmdjaga/segformer_b2_clothes`, 18 labels) runs in `cv2.dnn` and labels every pixel as background, a body part or a garment class. The input is resized to 512×512 (`SEG_SIZE`) and normalized with ImageNet mean and standard deviation; the output is 18 logits at a quarter of the input size ([`vision/app/models.py`](../../vision/app/models.py)). Weights come from pinned Hugging Face revisions with SHA-256 checks ([`vision/scripts/fetch_models.py`](../../vision/scripts/fetch_models.py)).
2. **Merge regions.** The person is the largest connected foreground component after dilation; under 1% foreground means no person. Garment labels become pieces ordered head to toe; left and right shoes merge into one piece; regions under 0.5% of the image are dropped (`MIN_AREA_FRAC`). Face, hair, arms and legs never become pieces ([`vision/app/analyze.py`](../../vision/app/analyze.py)).
3. **Measure color.** Each mask is eroded slightly, then k-means (k=3) runs on its pixels in Lab space (`cv2.kmeans`). The dominant cluster is named with the nearest, by CIEDE2000, of 34 retail color names. A piece is `patterned` when a second cluster covers more than 25% of the mask and is more than 20 ΔE away, or when Canny edges cover more than 15% of the eroded mask ([`vision/app/colors.py`](../../vision/app/colors.py)).
4. **Embed and classify.** The crop is padded to a white square, resized to 224×224 and run through the CLIP ViT-B/32 image encoder in `cv2.dnn` to a 512-d normalized vector. It's compared by cosine similarity against precomputed CLIP text embeddings of a 293-phrase garment vocabulary (`vision/vocabulary.json`, `vocabulary.npy`), restricted to phrases for the same region. A whole-figure crop is embedded too and mixed in at weight 0.5 (`CONTEXT_WEIGHT`), because a hat alone is ambiguous where a hat on a cowboy isn't; that context embedding is used only for classification and never returned.
5. **Write the query.** The search query is the dominant color plus the best garment phrase, for example "brown felt cowboy hat", with an alternate phrasing for a second search. DIY items carry an assembly note (for example, a bedsheet ghost).

**Match** (`POST /v1/match`) scores up to 12 product photos against one piece. It finds the garment in each photo with GrabCut (seeded with a mask, 3 iterations) when the photo has a white background, otherwise with the segmenter, and as a last resort with a mask of pixels far in Lab from the median border color ([`vision/app/match.py`](../../vision/app/match.py)). It then computes three measurements: CLIP embedding similarity to the screenshot crop, CIEDE2000 distance between dominant Lab colors, and `cv2.compareHist` correlation on masked hue-saturation histograms. A weighted score maps to a verdict (`match`, `weak`, `reject`) with a list of reasons (`color_mismatch`, `type_mismatch`, `no_garment`, `low_quality`). The reasons are what the agent loop reads. The score is 0.55 × embedding (rescaled from 0.55–0.90 to 0–1) + 0.30 × color (1 − ΔE/40) + 0.15 × histogram correlation. A score of 0.60 or more is a match unless a color or type reason applies; 0.40 or more is weak. `color_mismatch` fires at ΔE above 25, `type_mismatch` at embedding similarity below 0.68, and `low_quality` when the photo's short side is under 200 px or the variance of its Laplacian is under 40 ([`vision/app/scoring.py`](../../vision/app/scoring.py)). These are hand-set starting values; they weren't tuned on the evaluation set before the deadline.

| OpenCV 5 function | Used for |
|---|---|
| `cv2.dnn.readNet`, `blobFromImage`, `Net.forward` | SegFormer segmentation, CLIP embeddings |
| `cv2.imdecode`, `resize` (INTER_AREA), `imencode` | Decoding uploads, capping at 1024 px, returning crops |
| `cv2.kmeans` (with `setRNGSeed`), `cvtColor` (Lab, HSV, gray) | Dominant colors, deterministic across runs |
| `cv2.erode`, `dilate`, `morphologyEx`, `connectedComponentsWithStats`, `connectedComponents`, `boundingRect` | Person mask, mask cleanup, region crops |
| `cv2.Canny`, `GaussianBlur` | Pattern detection |
| `cv2.grabCut` (`GC_INIT_WITH_MASK`) | Product-photo foreground |
| `cv2.calcHist`, `normalize`, `compareHist` (`HISTCMP_CORREL`) | Color histogram similarity |
| `cv2.Laplacian` | Blurry product photos (`low_quality`) |

## 5. AWS deployment

The service runs as one container on an EC2 `c8g.xlarge` (Graviton4, arm64) in `us-east-1` with an Elastic IP. CloudFront sits in front of it with caching disabled, all HTTP methods allowed, a 60 s origin read timeout and viewers redirected to HTTPS. The instance's security group accepts port 8080 only from CloudFront's managed origin-facing prefix list. The container image lives in ECR (`halloween-vision`), and the shared bearer token is a random SSM SecureString (`/halloween/vision/token`) that the instance role reads at start and passes to the container as `VISION_SERVICE_TOKEN`.

Deploys don't need SSH. `./30-instance.sh deploy cool` writes the image tag to SSM (`/halloween/vision/image-tag`) and uses SSM Run Command to restart the container with it. The instance requires IMDSv2, has an encrypted 30 GB gp3 volume, no key pair and no inbound port 22, so operators use SSM Session Manager. If the account is not subscribed to COOL, the script falls back to stock Ubuntu 24.04 arm64 and tags the instance `Build=stock`, and a `cool` image refuses to start when `/opt/cool` is missing, so the build that serves traffic is never ambiguous.

The service writes one JSON log line per request (route, status, latency, piece count, build and stage timings) to CloudWatch Logs (`/halloween/vision`, 14-day retention). Metric filters turn those lines into `Requests`, `LatencyMs` by route and `Errors5xx` in the `Halloween/Vision` namespace, and the CloudWatch agent adds CPU and memory. The `halloween-vision` dashboard shows requests per minute, `/v1/analyze` p50 and p95, 5xx errors, CPU, memory and a table of recent requests.

Everything is created by idempotent AWS CLI scripts in `infra/`, run in numbered order, and removed by `./99-teardown.sh`, which asks for confirmation. See [`infra/README.md`](../../infra/README.md). The running service costs about $0.18 an hour on demand: $0.159 for the instance, about $0.01–0.02 for the COOL software fee, and small amounts for the Elastic IP and storage ([`infra/README.md`](../../infra/README.md)). The three benchmark instances add about $0.50 an hour while they run, and they terminate themselves 4 hours after boot.

## 6. COOL

We use the [Cloud Optimized OpenCV For AWS Graviton4](https://aws.amazon.com/marketplace/pp/prodview-fdvbfiewzuehs) AMI (Ubuntu, arm64) on a `c8g.xlarge` in `us-east-1`. COOL installs its OpenCV on the host under `/opt/cool`, with Python 3.12 bindings and C++ libraries. We also looked at COOL's Docker listing, but it meters usage through ECS or EKS and exits on a plain EC2 Docker host, so we kept our own container and gave it COOL instead: the host mounts `/opt/cool` read-only into the container and points `PYTHONPATH` and `LD_LIBRARY_PATH` at it ([`infra/30-instance.sh`](../../infra/30-instance.sh)). The COOL image ([`vision/Dockerfile.cool`](../../vision/Dockerfile.cool)) is Ubuntu 24.04 with system Python 3.12; it installs every locked dependency except OpenCV and sets `OPENCV_BUILD=cool`.

The service code does not care which `cv2` it imports. The stock image pins `opencv-python-headless==5.0.0.93`; the COOL image (Ubuntu 24.04 with system Python 3.12, matching the AMI) installs no OpenCV of its own and imports COOL's from the mount. `/healthz` and every response header report `build: "cool"` or `"stock"`, taken from `OPENCV_BUILD` or detected from `cv2.getBuildInformation()`, so a judge can confirm which build served a request.

The benchmark is planned but hasn't run: `vision/bench/` isn't written yet, and only the instances it runs on exist ([`infra/60-bench-instances.sh`](../../infra/60-bench-instances.sh)). The plan is to import the same service modules in-process and run a fixed workload, the 25 catalog images through analyze plus 25 match calls with 6 candidate photos each, with 3 warm-up and 10 measured runs, and to time the individual OpenCV operations the service uses. It covers three configurations: COOL on Graviton, stock `opencv-python-headless==5.0.0.93` on the same Graviton instance type, and stock on x86 (`c7i.xlarge`). Each result file will record `cv2.getBuildInformation()` as evidence of which build ran. Until it runs, we make no performance claim for COOL; what this entry shows is that COOL's build serves production traffic and that every response says so.

| Configuration | Instance | analyze p50 | analyze p95 | match p50 | images/s | $ per 1,000 images |
|---|---|---|---|---|---|---|
| COOL, Graviton | TODO(numbers) | | | | | |
| Stock, Graviton | TODO(numbers) | | | | | |
| Stock, x86 | c7i.xlarge | TODO(numbers) | | | | |

Source: [`vision/bench/out/cool.md`](../../vision/bench/out/cool.md). TODO(numbers).

## 7. Agent workflow

![Agent loop](agent-workflow.svg)

The loop runs once per garment, at most 8 garments, inside the 30 s search budget ([`lib/sourcing/screenshot.ts`](../../lib/sourcing/screenshot.ts)):

1. **Perceive.** `/v1/analyze` returns the pieces. If no person is found, the person confidence is below 0.5, or no pieces come back, the route stops with a 422 before any search and asks the shopper to crop the screenshot to one person, head to toe.
2. **Act.** Search merchants with the piece's query. The first attempt also searches the alternate phrasing.
3. **Re-perceive.** Fetch each candidate's product photo (resized to 600 px JPEG) and send them to `/v1/match`.
4. **Decide.** One table-driven function, `decideNext`, picks the next action from the verdicts and reasons. The rules run in this order:

| Observation | Next action |
|---|---|
| Best non-rejected result is a `match` | Accept the product |
| 2 retries used, or under 6 s of budget left | Keep the best `weak` product and ask the shopper to approve it |
| No candidates, or half or more report `no_garment` | Search again with the alternate query |
| `color_mismatch` is the most common reason | Search again with the measured color name in front of the garment phrase (top two colors) |
| Any `type_mismatch` | Search again with the color and the next garment phrase from `garment_types` |
| Anything else | Search again with the alternate query |

A query that was already tried is skipped, and when no new query is left the agent asks for approval instead of repeating itself. Each retry changes one thing in the query, so the trace shows which change found the better product.

This is what makes it agentic in the sense the award describes: the visual measurement changes the next action. A `color_mismatch` on a hat produces a different query than a `type_mismatch` on the same hat, and both are different from asking the shopper.

**Trace.** Each step appends `{t_ms, piece, step, detail}`, where `step` is `perceive`, `search`, `score`, `decide` (each with its attempt number) or `approve`. The route streams it to the browser as `trace` events, and the `look` event carries each piece's OpenCV crop, measured colors and garment types. At the end the route writes the whole trace to the Vercel log as one `screenshot_agent_trace` line. The browser shows it in a "How we matched this" panel under each look (`components/store/screenshot-costume.tsx`): the crop, the color swatches with their share, the top three garment types, every query with its result count, the top three scores with verdict and reasons, and each retry with its cause. A weak match appears as an approval card with the reason, and the piece reaches the cart only after the shopper picks "Use this anyway". TODO(numbers): a recorded trace with a retry that found a better match, saved to `eval/traces/` once the agent evaluation runs.

## 8. Evaluation

Only the `gpt-6-luna` baseline has been run so far. The OpenCV decomposition, the agent-loop run and the human labels need the vision service deployed, and they are not in `eval/out/` yet, so their cells below say "not run" rather than holding a number.

**Data.** The 25 catalog costumes, each with an editorial image (`public/costumes/*.png`, ghost-mannequin renders on a transparent background, flattened onto white JPEGs in `eval/fixtures/editorial/` so OpenCV and the baseline get the same bytes) and a ground-truth list of purchasable components with slot, garment phrase and main color family (`eval/ground-truth.json`). The lists were drafted from the catalog piece lists (`data/costumes/*.json`) and a visual pass over each image; pieces that are not visible, such as DIY fabric or hidden base layers, are listed as excluded and not scored. We drafted these lists ourselves and checked them against the images; no outside annotator reviewed them, and some colors (burgundy against purple, gold against white) are a judgment call.

**Decomposition** (`scripts/eval-decompose.ts`). Each editorial image goes through `/v1/analyze` and, as a baseline, through the previous `gpt-6-luna` decomposition. Predicted pieces are matched to ground truth by slot and garment-phrase similarity.

| Metric | OpenCV 5 | gpt-6-luna |
|---|---|---|
| Precision | not run | 88.1% |
| Recall | not run | 98.3% |
| Slot accuracy (matched pieces) | not run | 100.0% |
| Color-name accuracy (matched pieces) | not run | 86.4% |
| Pieces predicted / ground truth | not run | 134 / 120 |
| Failed requests | not run | 0 of 25 |
| Latency per image (p50 / p95) | not run | 5528 / 7293 ms |
| Cost per image | not run | 2413 input + 455 output tokens |

Source: [`eval/out/decompose.md`](../../eval/out/decompose.md), with the raw answers in [`eval/out/decompose-luna.json`](../../eval/out/decompose-luna.json). The 25 images hold 120 scored components, so one costume moves recall by about 0.8 points.

The baseline finds almost every piece, and its low precision comes from extras it names that the ground truth doesn't list, such as goggles and a satchel on the clockwork aviator. Its weakest dimension is color: on the enchanted jester it calls four purple pieces burgundy (1 of 5 colors right), and on the moon moth it gets 1 of 3. It misses two pieces in total, the moon moth's white fur collar and the raven scholar's headpiece, which it describes as a raven mask instead. These are the cases the OpenCV color measurement is meant to fix, so they're the first ones to check once the OpenCV column exists.

**Agent loop** (`scripts/eval-agent.ts`). The full route in `opencv` mode on all 25 images.

| Outcome | Pieces |
|---|---|
| Matched on the first search | not run |
| Recovered by a retry | not run |
| Left as `needs_approval` | not run |
| Unmatched | not run |
| Time to first match (p50) | not run |
| Time to completion (p50) | not run |
| Human-labelled acceptable matches | not run |

`bun scripts/eval-agent.ts` writes these to `eval/out/agent.md` once the route runs in `opencv` mode against a deployed service; see [reproduce.md](reproduce.md#4-rerun-the-evaluation).

## 9. Limitations and failure cases

The named failure cases measured so far are the baseline ones in section 8: purple read as burgundy on the enchanted jester, the moon moth's collar missed, and the raven scholar's headpiece renamed. OpenCV failure cases need the OpenCV run.

- The evaluation images are generated ghost-mannequin renders, mostly without a head, not real screenshots of people, and there are only 25. The ground truth was drafted by us from our own catalog, and garment-phrase matching uses a small synonym table, so it is approximate.
- The garment vocabulary is fixed. A garment that isn't in it gets the nearest phrase, which can produce a reasonable color with the wrong noun.
- Clothes parsing labels 18 classes. Costume-specific items (capes, wings, masks, props) have no label of their own, so they fall into the nearest class or are missed. The moon moth's wings and the raven scholar's capelet are the evaluation pieces most exposed to this.
- Merchant search coverage and inventory, not perception, limit many results: a perfect query can still return no good product within 30 s.
- The service handles one person per screenshot. A group photo, or a crop where the segmenter's person confidence is under 0.5, gets a 422 asking the shopper to crop, and nothing is searched.
- CloudFront talks to the instance over plain HTTP on port 8080. The security group limits that hop to CloudFront's address ranges, but the image bytes and the bearer token are not encrypted between CloudFront and the origin. An origin certificate would close this.

## 10. Responsible use

The system reads clothing only. It loads no face or identity model, titles a look by its garments, does not store or log images, strips EXIF before analysis, and never buys anything without the shopper; weak matches need explicit approval. The full list, with the code or configuration that enforces each point, is in [responsible-use.md](responsible-use.md).
