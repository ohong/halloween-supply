# Halloween Supply

A curated costume store built from individual pieces at independent merchants.
All 50 costumes have saved shopping catalogs with three distinct price points
for each purchasable component: $, $$, and $$$. Components are separate garments,
confirmed bundles, or clearly described DIY supplies. Every look supports merchant
links, swaps, budget styling, cart selections, and the generated inspiration image.
The homepage shows each look on the same male or female model. Its model toggle
switches all 50 previews and each costume page's first carousel image. The browser
remembers the choice across navigation and refreshes. The 100 transparent images and their generation prompts
are saved in `public/costumes/models/` and `docs/design/model-gallery-image-prompts.json`.

Upload a screenshot of a costume and the store turns it into a shoppable look.
Then try the look on in a photo or in a live video mirror.

## Computer vision: OpenCV 5 on AWS

OpenCV 5 does all image analysis in the product. It runs in a separate vision
service in `vision/`, deployed on AWS. No language model looks at pixels. Language
models only write text: the shopping assistant, outfit decisions, and spoken replies.
Image generation models only render the try-on.

### Vision service

The service is a Python FastAPI app. Its runtime dependencies are `fastapi`,
`uvicorn`, `numpy`, and OpenCV 5. There is no PyTorch, ONNX Runtime, or
Transformers at runtime. Both neural networks run through `cv2.dnn`:

- **SegFormer-B2 clothes parser** (ONNX, 512×512 input). It labels each pixel as
  hat, upper clothes, dress, skirt, pants, belt, shoes, bag, scarf, sunglasses,
  skin, hair, or background.
- **CLIP ViT-B/32 image encoder** (ONNX, 224×224 input). It gives a 512-d
  L2-normalized embedding for each garment crop.

The weights come from pinned Hugging Face commits and are checked by SHA-256 at
image build time. [vision/README.md](vision/README.md) lists sources, licenses, and hashes.

The service has three endpoints. The contract is in `vision/README.md`.

| Endpoint | What OpenCV does |
|---|---|
| `GET /healthz` | Reports `cv2.__version__`, the build (`cool` or `stock`), the CPU architecture, and model fingerprints. |
| `POST /v1/analyze` | Splits one photo into garment pieces, head to toe. |
| `POST /v1/match` | Scores merchant product photos against one analyzed piece. |

`/v1/analyze` runs this pipeline on each image:

1. **Decode and scale** with `cv2.imdecode` and `cv2.resize` to a long side of 1024 px.
2. **Segment** with the SegFormer net in `cv2.dnn`. Masks for left and right shoes
   merge, and very small regions are dropped.
3. **Clean the masks** with `cv2.erode`, so hair, skin, and background do not leak
   into garment colors.
4. **Measure color** with `cv2.kmeans` (k=3) on masked pixels in Lab space
   (`cv2.cvtColor`). Each cluster gets the nearest of about 30 retail color names.
5. **Detect pattern** from the second cluster's share and ΔE, and from `cv2.Canny`
   edge density inside the mask.
6. **Embed and classify** each crop with CLIP in `cv2.dnn`. Cosine similarity
   against `vision/vocabulary.json` (garment phrases with CLIP text embeddings
   precomputed offline) gives the top 3 garment types for the piece's region.
7. **Outline** each mask with `cv2.findContours` and `cv2.approxPolyDP`, so the UI
   can draw the segmentation over the shopper's screenshot.

Each piece comes back with its slot, bbox, outline, colors, pattern, garment
types, a search query such as "brown felt cowboy hat", an alternate query, and its
embedding.

`/v1/match` finds the garment in each product photo, then compares it with the piece:

- **Foreground.** Photos with a model in them use the segmenter. Flat product shots
  on white use `cv2.grabCut`, seeded from a white-background threshold and the image border.
- **Type.** Cosine similarity of CLIP embeddings.
- **Color.** CIEDE2000 between dominant Lab colors.
- **Color distribution.** `cv2.compareHist` correlation on masked HS histograms (`cv2.calcHist`).

The weighted score gives a verdict (`match`, `weak`, or `reject`) and reasons
(`color_mismatch`, `type_mismatch`, `no_garment`, `low_quality`). The weights and
thresholds are constants in `vision/app/scoring.py`, tuned on the evaluation set in `eval/`.

### Where the app uses it

- **Screenshot to costume** (`/screenshot`, `/api/screenshot-costume`).
  `/v1/analyze` breaks the screenshot into pieces. An agent loop in `lib/sourcing/`
  searches merchants for each piece and scores the results with `/v1/match`. A
  table-driven rule (`decideNext`) reads the verdict. A `color_mismatch` retries
  with the measured color first. A `type_mismatch` retries with the next garment
  type. No candidates retries with the alternate query. After two retries, or when
  the time budget is low, the best weak result waits for the shopper's approval and
  does not go into the cart. Each step streams to the UI as a trace. The "How we
  matched this" panel shows the OpenCV crop, outline, colors, scores, and retries.
- **Budget stylist** (`/api/outfits`). `/v1/analyze` runs once on each costume's
  inspiration image, and the result is cached. `/v1/match` scores every candidate
  product photo against its piece. The stylist gets the verdicts, color distances,
  and reasons as text evidence. It never gets images.
- **Live mirror style feedback** (`/api/live-mirror/feedback`). When the shopper
  asks how the outfit looks, one consented frame goes to `/v1/analyze`. The route
  compares each observed piece with the selected outfit by slot and CIEDE2000 color
  distance, for example "the cape renders maroon, not the red you picked". The
  voice assistant speaks those observations. Feedback covers garments, colors, and
  pattern only. It never assesses faces or identity.

If the vision service fails, these features return a clear error. They never fall
back to a language model for vision.

### AWS deployment

```text
Vercel (Next.js) ──HTTPS──> CloudFront ──HTTP:8080──> EC2 c8g.xlarge (Graviton4, COOL AMI)
                                                       └ Docker: ECR halloween-vision:cool
                                                         logs/metrics -> CloudWatch
```

- **EC2 Graviton4 with COOL.** The service runs on a `c8g.xlarge` in `us-east-2`,
  booted from the Cloud-Optimized OpenCV Library (COOL) Graviton4 AMI. The container
  mounts the host's `/opt/cool` read-only and imports COOL's `cv2`. `/healthz`
  reports `"build":"cool","arch":"aarch64"`. The same code also runs on stock
  `opencv-python-headless==5.0.0.93`, which the benchmark uses as a baseline.
- **CloudFront** gives the service HTTPS, with caching off and a 60 s origin timeout.
  The origin security group allows port 8080 from the CloudFront managed prefix list only.
- **ECR** stores the arm64 images (`halloween-vision:cool` and `:stock`).
- **SSM Parameter Store** holds the bearer token (`/halloween/vision/token`,
  SecureString). The instance reads it through its role at boot.
- **CloudWatch** stores one JSON log line per request (`/halloween/vision`). Metric
  filters turn them into request count, p50/p95 latency by route, and 5xx errors on
  the `halloween-vision` dashboard, next to CPU and memory.
- **Security.** IMDSv2 is required. The instance role can only pull from ECR, read
  one SSM parameter, and write to CloudWatch. There is no SSH and no public ingress
  except CloudFront; shell access is SSM Session Manager. EBS is encrypted. Every
  request except `/healthz` needs the bearer token. Callers send image bytes, and the
  service never fetches URLs, which prevents SSRF. Requests are limited to 12 images
  of 4 MB each. The service does not store images and does not log images or embeddings.

All infrastructure is idempotent AWS CLI scripts in `infra/`, run in order
(`10-network-iam.sh` to `50-observability.sh`). `60-bench-instances.sh` starts the
benchmark instances, and `99-teardown.sh` removes everything. See
[infra/README.md](infra/README.md).

### Evaluation and benchmark

- `eval/` measures piece decomposition precision and recall on the 25 catalog
  costumes, the agent loop's recovery rate after a weak match, and latency. Example
  traces are in `eval/traces/`.
- `vision/bench/` compares COOL on Graviton4 with stock OpenCV 5 on the same
  instance type and on x86 (`c7i.xlarge`).
- Results, the architecture diagram, and reproduction steps are in
  [docs/opencv-competition/](docs/opencv-competition/report.md).

## Search and custom looks

The landing search filters locally while you type. Direct Anthropic inference
then ranks the existing catalog by meaning. The selected model and Saved view
continue to work with filtered results. Search uses bounded requests and falls
back to clearly labelled local matches when semantic refinement is unavailable.

Create starts only after a click. It plans a new costume, checks merchant offers
and their relevance, and saves an unlisted result in Turso. New looks show real
product photos, prices, sizes and missing components. They support the cart and
live checkout checks, but do not join the reviewed three-price-tier catalog.
No generated model image is claimed for custom looks.

See [the implementation spec](docs/semantic-search-and-create.md).

## OpenCV AI Competition

Screenshot sourcing (`/screenshot`) runs on an OpenCV 5 vision service hosted on
AWS Graviton with COOL. OpenCV segments the person into garments, measures their
colors, and scores every merchant product photo. An agent loop reads those scores
and searches again or asks the shopper when a match is weak. `SCREENSHOT_VISION=luna`
switches back to the previous language-model path.

- [Report](docs/opencv-competition/report.md), with the evaluation and COOL benchmark
- [Reproduce](docs/opencv-competition/reproduce.md): local run, AWS deploy, eval and bench commands
- [Responsible use](docs/opencv-competition/responsible-use.md)
- Code: `vision/` (service), `infra/` (AWS scripts), `lib/sourcing/` (agent loop), `eval/` (evaluation)

## Run

```sh
bun install
bun run dev
```

Open http://localhost:3000. For a production build, run `bun run build`, then `bun run start`.

## Catalog and checkout

`brief.md` defines the product requirements. Firecrawl discovers product pages and
fetches their raw HTML. The pipeline checks merchant facts, ranks products through
the direct Anthropic API, and saves each complete costume to Turso.

The database uses one validated JSON catalog per costume. This keeps publication
atomic and reuses the same queries for live data and the bundled fallback.
`lib/catalog.ts` is the shared data access surface for pages, assistant tools, and
checkout. Checkout always rechecks the merchant's current price, stock, and size.
Customers approve price changes before continuing.

The full 50-costume catalog was researched with built-in web search and direct
merchant evidence, with no Firecrawl used for this research pass. Research records
for the original 25 looks are in `docs/sourcing/price-tiers/`. The 25 new looks
have evidence in `docs/sourcing/expansion-{a,b,c,d,e}.{json,md}`. They reuse
appropriate reviewed basics and add newly checked defining pieces. DIY looks
state assembly steps and extra supplies; made-to-order options do not promise
arrival by Halloween.

The budget stylist at `/api/outfits` uses OpenAI Decisions (`gpt-6-luna`) to compare
complete affordable outfits. It receives OpenCV match verdicts for the merchant
photos as text, product facts, and the shopper's budget, sizes, owned pieces, event date, and notes.
Code enforces constraints before the model chooses a catalog outfit. It never
invents products or prices, spends beyond the pieces budget, or pretends an API
failure is an AI recommendation. Explicitly late production times are excluded;
arrival remains unconfirmed. Chat continues to use Anthropic directly.

The assistant records sizes and updates the guest cart. Stripe collects email and
a US shipping address. The concierge can read merchant, product URL, and size from
each Stripe product's metadata. Fulfillment remains manual.

Required variables: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `FIRECRAWL_API_KEY`, `TURSO_DATABASE_URL`,
`TURSO_AUTH_TOKEN`, `STRIPE_SECRET_KEY`, `CRON_SECRET`, `VISION_SERVICE_URL` (the
CloudFront URL), and `VISION_SERVICE_TOKEN`. Keep credentials in
`.env.local` and Vercel environments. Never commit them.

```sh
bun --env-file=.env.local scripts/seed.ts --all
bun --env-file=.env.local scripts/catalog-check.ts
bun --env-file=.env.local scripts/source/index.ts cosmic-cowboy --skip-images
```

Original editorial images are in `public/costumes/`. Their prompts are recorded
in `docs/design/costume-image-prompts.json`. Prompts for the twenty additional costumes
are recorded in `docs/design/new-costume-image-prompts.json`. The next 25 looks
have prompts in `docs/design/expansion-{a,b,c,d,e}-images.json`. Product images come
from the checked merchant listings.

## Checks

### Costume Mirror

Each costume page includes a fullscreen live mirror with voice and typed outfit
commands, piece alternatives, kept/owned pieces, budget controls, undo, and saved
look comparisons. Applying a look updates the existing page selections; it does
not place an order. Photo try-on remains available.

Style feedback in the mirror comes from the OpenCV vision service, described above.
The mirror reuses `OPENAI_API_KEY` for GPT-Live and native Decisions, which only handle text and speech. Set
`DECART_API_KEY` on the server to enable transformed live video. The video session
uses a short-lived, model-restricted token and is capped at three minutes. Missing
credentials show an unavailable state rather than a simulated transformation.
See [the mirror implementation and demo checklist](docs/live-costume-mirror.md).

```sh
bun run lint
bun run typecheck
bun run build
bun run start
# In another terminal, with the production build running:
bun scripts/verify-v1.ts http://localhost:3000 --checkout
bun scripts/verify-chat.ts http://localhost:3000
bun --env-file=.env.local scripts/verify-stylist.ts http://localhost:3000 --costume=midnight-pirate
bun --env-file=.env.local scripts/verify-full-catalog.ts http://localhost:3000
bun scripts/verify-model-gallery.ts http://localhost:3000
bun scripts/verify-costume-search.ts http://localhost:3000 --require-semantic
# Optional: source and save one real custom look, without payment:
# bun scripts/verify-costume-search.ts http://localhost:3000 --require-semantic --create
```

Verification calls the real app, Turso, Anthropic, merchant pages, and Stripe.
The checkout check creates and expires an unpaid session. It does not make a
payment. It requires `STRIPE_SECRET_KEY` for the same account as the running app.
There are no product or provider mocks in these checks.

## Deployment

The private GitHub repository is `ohong/halloween-supply`.
Vercel project `halloween-supply` in the Pacific Systems team uses the GitHub integration.
Each push to `main` creates a production deployment automatically.
Other branches create preview deployments using Vercel's project defaults.

Production URL: https://halloween.supply

The vision service deploys separately to AWS from `infra/` (see above). Vercel
reaches it through `VISION_SERVICE_URL`.

Local environment files, Stripe state, and generated agent integrations are excluded from Git.

Vercel runs `/api/cron/refresh` daily at 10:00 UTC. It requires the `CRON_SECRET`
Bearer token. The refresh updates database prices, sizes, and stock, then invalidates
the cached costume page. `/api/health` reports configuration booleans and database
status without exposing credentials.

## Limits

Merchant shipping costs are excluded from the total. The concierge absorbs them.
Orders from several merchants have no guaranteed arrival date. A checkout session
does not reserve merchant inventory. Confirm merchant stock again during manual
fulfillment, and refund unavailable items.

If the Stripe key is a test key, Checkout takes test payments only. A successful
unpaid-session check does not prove a completed payment or a fulfilled order.
