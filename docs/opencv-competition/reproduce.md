# Reproduce

This page rebuilds the OpenCV 5 vision service, runs the storefront against it, deploys it to AWS Graviton with COOL, and reruns the evaluation and benchmark. Each command is the one we ran; anything not yet confirmed against the committed scripts is marked `TODO(verify)`.

## Pinned versions

| Component | Version | Where it is pinned |
|---|---|---|
| Python | 3.12 | `vision/pyproject.toml` TODO(verify) |
| OpenCV (stock build) | `opencv-python-headless==5.0.0.93` | `vision/pyproject.toml`, `vision/uv.lock` TODO(verify) |
| OpenCV (COOL build) | "Cloud Optimized OpenCV For AWS Graviton4" AMI, Python 3.12 bindings under `/opt/cool` | `infra/30-instance.sh` TODO(verify) |
| FastAPI, uvicorn, numpy | see lockfile | `vision/uv.lock` |
| Models | SegFormer-B2 clothes (ONNX), CLIP ViT-B/32 image encoder (ONNX) | `vision/models/README.md` TODO(verify): file names, checksums, licenses |
| Bun | TODO(verify) | `bun.lock` |
| Next.js | 16.4.3 | `package.json` |
| AWS CLI | v2 | — |

Tools: [uv](https://docs.astral.sh/uv/) for Python, [Bun](https://bun.sh) for the storefront, Docker with arm64 support (native on Apple silicon or Graviton), and AWS CLI v2 for the deploy.

## 1. Run the vision service locally

TODO(verify): commands against `vision/README.md` on `oh-cv-service`.

```bash
cd vision
uv sync
uv run python scripts/fetch_models.py
VISION_SERVICE_TOKEN=dev-token uv run uvicorn app.main:app --port 8080
```

Or with Docker (stock OpenCV, arm64):

```bash
docker build -t halloween-vision:stock -f vision/Dockerfile vision
docker run --rm -p 8080:8080 -e VISION_SERVICE_TOKEN=dev-token halloween-vision:stock
```

Check it:

```bash
curl -s localhost:8080/healthz
```

The response names the OpenCV version, `build` (`stock` here) and `arch`. Then run the contract smoke test, which calls every endpoint with a catalog image:

```bash
cd vision && VISION_SERVICE_URL=http://localhost:8080 VISION_SERVICE_TOKEN=dev-token uv run python smoke.py
```

## 2. Run the storefront against it

```bash
bun install
cp .env.example .env.local
```

Set these in `.env.local`, in addition to the store's existing keys (Turso, Stripe test key, Firecrawl):

| Variable | Value | Purpose |
|---|---|---|
| `SCREENSHOT_VISION` | `opencv` (default) or `luna` | Which perception path `/api/screenshot-costume` uses. `luna` is the previous language-model path, kept for comparison. |
| `VISION_SERVICE_URL` | `http://localhost:8080` locally, the CloudFront URL in production | Base URL of the vision service. With `opencv` selected and this unset, the route returns 503. |
| `VISION_SERVICE_TOKEN` | the same token the service was started with | Bearer token on every request except `/healthz`. |
| `FIRECRAWL_API_KEY` | your key | Merchant search and product-photo discovery. |
| `OPENAI_API_KEY` | your key | Only needed for `SCREENSHOT_VISION=luna` and the baseline in the evaluation. TODO(verify): whether the route still requires it in `opencv` mode. |

```bash
bun run dev
```

Open http://localhost:3000/screenshot and upload a costume image, for example `eval/fixtures/editorial/cosmic-cowboy.jpg`.

## 3. Deploy to AWS Graviton with COOL

The full procedure, with every resource the scripts create, is in [`infra/README.md`](../../infra/README.md). In short:

1. Subscribe to the COOL listing in AWS Marketplace with the account owner's login. TODO(verify): listing URL in `infra/README.md`.
2. Run the numbered scripts in order from the repo root. Each one is idempotent and prints what it created.

```bash
source infra/00-env.sh
bash infra/10-network-iam.sh
bash infra/20-ecr.sh
bash infra/30-instance.sh
bash infra/40-cloudfront.sh
bash infra/50-observability.sh
```

3. Push the service image to ECR (TODO(verify): push command and tags `stock` and `cool`), then confirm the deployed build:

```bash
curl -s "$VISION_SERVICE_URL/healthz"
```

It should report `"build":"cool"` and `"arch":"aarch64"`.

4. Add `VISION_SERVICE_URL` and `VISION_SERVICE_TOKEN` to the Vercel project (TODO(verify): exact commands in `infra/README.md`).

Remove everything with:

```bash
bash infra/99-teardown.sh
```

## 4. Rerun the evaluation

TODO(verify): commands against `eval/README.md` on `oh-cv-eval`.

Decomposition, OpenCV against the `gpt-6-luna` baseline, on the 25 catalog images in `eval/fixtures/editorial/` (the catalog's ghost-mannequin renders, flattened onto white):

```bash
bun scripts/eval-decompose.ts
```

Writes `eval/out/decompose.md`. Needs `VISION_SERVICE_URL`, `VISION_SERVICE_TOKEN` and, for the baseline, `OPENAI_API_KEY`.

Agent loop, the full route in `opencv` mode against a running storefront:

```bash
bun run build && bun run start
bun scripts/eval-agent.ts http://localhost:3000
```

Writes `eval/out/agent.md`, `eval/out/contact-sheet.html` and traces in `eval/traces/`. Human match labels are in `eval/match-labels.json`.

## 5. Rerun the COOL benchmark

Start the three benchmark instances (COOL on Graviton, stock on Graviton, stock on x86 `c7i.xlarge`), run the benchmark on each, and stop them:

```bash
bash infra/60-bench-instances.sh up
```

On the COOL instance, run the benchmark with COOL's Python bindings:

```bash
PYTHONPATH=/opt/cool/python_3.12/site-packages LD_LIBRARY_PATH=/opt/cool/cpp_sdk/lib python3 vision/bench/bench.py
```

On the two stock instances:

```bash
cd vision && uv run python bench/bench.py
```

TODO(verify): how results are collected into `vision/bench/out/cool.md`.

```bash
bash infra/60-bench-instances.sh down
```

Each result file includes `cv2.getBuildInformation()`, so you can confirm which OpenCV build produced each row.

## Checks

```bash
bun run lint
bun run typecheck
bun run build
```
