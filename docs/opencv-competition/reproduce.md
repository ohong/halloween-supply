# Reproduce

This page rebuilds the OpenCV 5 vision service, runs the storefront against it, deploys it to AWS Graviton with COOL, and reruns the evaluation and benchmark. Each command matches the committed scripts; steps that cannot run yet say so.

## Pinned versions

| Component | Version | Where it is pinned |
|---|---|---|
| Python | 3.12 | `vision/.python-version`, `vision/pyproject.toml` |
| OpenCV (stock build) | `opencv-python-headless==5.0.0.93` | `vision/pyproject.toml`, `vision/uv.lock` |
| OpenCV (COOL build) | "Cloud Optimized OpenCV For AWS Graviton4" AMI, Python 3.12 bindings under `/opt/cool` | `infra/30-instance.sh` |
| FastAPI, uvicorn, numpy | see lockfile | `vision/uv.lock` |
| Models | SegFormer-B2 clothes (ONNX), CLIP ViT-B/32 image encoder (ONNX) | `vision/scripts/fetch_models.py`: pinned Hugging Face revisions (`mattmdjaga/segformer_b2_clothes`, `Xenova/clip-vit-base-patch32`) with SHA-256 checks |
| Bun | 1.3.3 | `package.json` (`packageManager`) |
| Next.js | 16.4.3 | `package.json` |
| AWS CLI | v2 | — |

Tools: [uv](https://docs.astral.sh/uv/) for Python, [Bun](https://bun.sh) for the storefront, Docker with arm64 support (native on Apple silicon or Graviton), and AWS CLI v2 for the deploy.

## 1. Run the vision service locally

The service needs `VISION_SERVICE_TOKEN` set and exits without it. `fetch_models.py` downloads the two ONNX files the service loads and checks their hashes; `--all` also fetches the CLIP text model, which only `scripts/embed_vocabulary.py` needs.

```bash
cd vision
uv sync
uv run python scripts/fetch_models.py
VISION_SERVICE_TOKEN=dev-token uv run uvicorn app.main:app --port 8080
```

Or with Docker (stock OpenCV, arm64):

```bash
docker build --platform linux/arm64 -t halloween-vision:stock vision/
docker run --rm -p 8080:8080 -e VISION_SERVICE_TOKEN=dev-token halloween-vision:stock
```

Check it:

```bash
curl -s localhost:8080/healthz
```

The response names the OpenCV version, `build` (`stock` here) and `arch`. Then run the smoke test, which calls every endpoint with catalog images and writes overlay images to `vision/debug/`:

```bash
cd vision && VISION_SERVICE_TOKEN=dev-token uv run python scripts/smoke.py --url http://localhost:8080
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
| `OPENAI_API_KEY` | your key | Only needed for `SCREENSHOT_VISION=luna` and the luna baseline in the evaluation. In `opencv` mode the route doesn't check it. |

```bash
bun run dev
```

Open http://localhost:3000/screenshot and upload a costume image, for example `eval/fixtures/editorial/cosmic-cowboy.jpg`.

## 3. Deploy to AWS Graviton with COOL

The full procedure, with every resource the scripts create, is in [`infra/README.md`](../../infra/README.md). In short:

1. Subscribe to the [COOL Graviton4 AMI](https://aws.amazon.com/marketplace/pp/prodview-fdvbfiewzuehs) in AWS Marketplace with the account owner's login. Without it, `30-instance.sh` falls back to stock Ubuntu 24.04 and only the `stock` and `placeholder` tags run.
2. Run the numbered scripts in order from `infra/`. Each one sources `00-env.sh` itself, is idempotent and prints what it created. `20-ecr.sh` pushes an arm64 `placeholder` image that only answers `/healthz`, so the instance has something to start.

```bash
cd infra
./10-network-iam.sh
./20-ecr.sh
./30-instance.sh
./40-cloudfront.sh
./50-observability.sh
```

3. Build both images for arm64 (`vision/Dockerfile` for `stock`, `vision/Dockerfile.cool` for `cool`), push them to the `halloween-vision` ECR repository with those tags, then switch the instance to the COOL build. `deploy` writes the tag to SSM and restarts the container through SSM Run Command; a `cool*` tag mounts `/opt/cool` read-only and points `PYTHONPATH` and `LD_LIBRARY_PATH` at it.

```bash
./30-instance.sh deploy cool
```

Confirm the deployed build:

```bash
curl -s "$VISION_SERVICE_URL/healthz"
```

It should report `"build":"cool"` and `"arch":"aarch64"`.

4. Add the CloudFront URL and the token to the Vercel project:

```bash
aws ssm get-parameter --name /halloween/vision/token --with-decryption --query Parameter.Value --output text
```

```bash
vercel env add VISION_SERVICE_URL production
```

```bash
vercel env add VISION_SERVICE_TOKEN production
```

Remove everything with the command below. It asks you to type `yes`, and it keeps the SSM token unless you pass `--all`.

```bash
./99-teardown.sh
```

## 4. Rerun the evaluation

The full instructions and the scoring rules are in [`eval/README.md`](../../eval/README.md).

Decomposition, OpenCV against the `gpt-6-luna` baseline, on the 25 catalog images in `eval/fixtures/editorial/` (the catalog's ghost-mannequin renders, flattened onto white by `scripts/eval-prepare.py`):

```bash
VISION_SERVICE_URL=http://localhost:8080 VISION_SERVICE_TOKEN=dev-token bun --env-file=.env.local scripts/eval-decompose.ts --pipeline both
```

This writes `eval/out/decompose.md` and caches the raw answers in `eval/out/decompose-<pipeline>.json`. `--pipeline opencv` or `--pipeline luna` runs one side, and `--rescore` rebuilds the report from the cache without calling either one.

Agent loop, the full route in `opencv` mode. Start the storefront with `SCREENSHOT_VISION=opencv`, `VISION_SERVICE_URL`, `VISION_SERVICE_TOKEN` and `FIRECRAWL_API_KEY` set, then:

```bash
bun scripts/eval-agent.ts --base http://localhost:3000
```

This writes `eval/out/agent.md` and `eval/out/contact-sheet.html`. Label each row of the contact sheet accept or reject, save the download as `eval/match-labels.json`, and run `bun scripts/eval-agent.ts --rescore` to add the human acceptance rate.

## 5. Rerun the COOL benchmark

Not runnable yet: the instance script exists, but `vision/bench/bench.py` hasn't been written, so the commands below are the intended procedure. Start the three benchmark instances (COOL on Graviton, stock on Graviton, stock on x86 `c7i.xlarge`), run the benchmark on each, and stop them:

```bash
cd infra && ./60-bench-instances.sh up
```

The instances have no inbound ports, so you reach them with SSM Session Manager. They terminate themselves 4 hours after boot if you forget `down`.

On the COOL instance, run the benchmark with COOL's Python bindings:

```bash
PYTHONPATH=/opt/cool/python_3.12/site-packages LD_LIBRARY_PATH=/opt/cool/cpp_sdk/lib python3 vision/bench/bench.py
```

On the two stock instances:

```bash
cd vision && uv run python bench/bench.py
```

```bash
cd infra && ./60-bench-instances.sh down
```

Each result file includes `cv2.getBuildInformation()`, so you can confirm which OpenCV build produced each row.

## Checks

```bash
bun run lint
bun run typecheck
bun run build
```
