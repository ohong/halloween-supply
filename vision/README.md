# halloween.supply vision service

A Python service that runs OpenCV 5 and implements `plans/contract.md` v1.1. `POST /v1/analyze` splits one costume photo into garment pieces, and for each piece returns its mask outline as polygons (for drawing the segmentation), its colors, its pattern, its three best garment phrases, a search query, and a 512-d embedding. `POST /v1/match` scores product photos against one of those pieces. `GET /healthz` reports the OpenCV version, which build is running (`stock` or `cool`), the CPU architecture, and fingerprints of the models.

All inference runs on the `cv2.dnn` default engine. The runtime dependencies are fastapi, uvicorn, numpy, and `opencv-python-headless==5.0.0.93`. There is no torch, onnxruntime, or transformers at runtime.

## Models

The repo does not hold the weights. `scripts/fetch_models.py` downloads each file from a pinned Hugging Face commit and stops with an error if the SHA-256 does not match. Both Dockerfiles run it at build time, so the weights are baked into the image.

| File | Use | Source (pinned commit) | License | SHA-256 |
|---|---|---|---|---|
| `segformer_b2_clothes.onnx` | Clothes segmentation (18 ATR labels), 512×512 input | [mattmdjaga/segformer_b2_clothes@584abc1e](https://huggingface.co/mattmdjaga/segformer_b2_clothes/tree/584abc1e1d260e23c0fc627c5217a09b2b461046) `onnx/model.onnx` | Model card says MIT, **but see the note below** | `a93a8dac171b5c1fcc53632a8bfc180bfd9759ea69a3e207451bb07f76add54f` |
| `clip_vit_b32_vision.onnx` | Image embeddings, 224×224 input | [Xenova/clip-vit-base-patch32@d15189d7](https://huggingface.co/Xenova/clip-vit-base-patch32/tree/d15189d7028b43f1d3e65039190477f6af591c2a) `onnx/vision_model.onnx` | MIT (OpenAI CLIP) | `fd6e1402a588279d1723c7534d4bcba5bc0b14b47dfab0e46f8c47b8270d7d40` |
| `clip_vit_b32_text.onnx` | Offline only: embeds `vocabulary.json` | same repo, `onnx/text_model.onnx` | MIT | `3f6571f5bad13a97c469c1622e1cfc4d9aef78b79fdbfcff804ca357bfada8cc` |
| `clip_tokenizer.json` | Offline only: tokenizer for the text model | same repo, `tokenizer.json` | MIT | `f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd` |

**License risk:** the SegFormer clothes model is a fine-tune of `nvidia/mit-b2`. NVIDIA released that backbone under its own license, which allows only non-commercial use. The fine-tune's MIT tag does not remove that restriction, so before a commercial launch someone must either accept this risk or swap in a segmenter with clean weights. The segmenter sits behind `SEGMENTER_FILE` and `REGION_LABELS` in `app/models.py`, so swapping it touches only that file.

`vocabulary.json` holds the garment phrases (region, slot, size kind, alternate phrase, assembly). `vocabulary.npy` holds their CLIP text embeddings, generated offline:

```bash
uv run python scripts/fetch_models.py --all
```

```bash
uv run --with onnxruntime --with tokenizers python scripts/embed_vocabulary.py
```

## Run locally

```bash
uv sync && uv run python scripts/fetch_models.py
```

```bash
VISION_SERVICE_TOKEN=dev-token uv run uvicorn app.main:app --port 8080
```

## Build the images

Both images are linux/arm64, which matches Graviton.

**Stock** (`Dockerfile`, about 1.5 GB) installs cv2 from PyPI:

```bash
docker build --platform linux/arm64 --build-arg GIT_SHA=$(git rev-parse --short HEAD) -t halloween-vision:stock .
```

```bash
docker run --rm -p 8080:8080 -e VISION_SERVICE_TOKEN=dev-token halloween-vision:stock
```

**COOL** (`Dockerfile.cool`, about 1.2 GB) is built on Ubuntu 24.04 with Python 3.12 and has **no cv2 inside it**. It uses the COOL build of OpenCV that the Graviton4 COOL AMI installs under `/opt/cool`, which you mount read-only:

```bash
docker build --platform linux/arm64 --build-arg GIT_SHA=$(git rev-parse --short HEAD) -f Dockerfile.cool -t halloween-vision:cool .
```

```bash
docker run --rm -p 8080:8080 -v /opt/cool:/opt/cool:ro -e PYTHONPATH=/opt/cool/python_3.12/site-packages -e LD_LIBRARY_PATH=/opt/cool/cpp_sdk/lib -e VISION_SERVICE_TOKEN=dev-token halloween-vision:cool
```

If the mount is missing, the COOL image fails at startup with `ModuleNotFoundError: No module named 'cv2'`. That failure is intentional, because it stops the service from falling back to a stock build without anyone noticing. Check `/healthz`: on the COOL host it must report `"build": "cool"`, and every response must carry the header `X-OpenCV-Build: 5.0.0;cool`. One risk is still unverified: if the COOL cv2 was compiled against numpy 1.x, it will not import next to the numpy 2.x in `uv.lock`.

## Push to ECR

The images go to `401921623247.dkr.ecr.us-east-2.amazonaws.com/halloween-vision` with the tags `stock` and `cool`. The repo is in us-east-2, because the account's SCP denies us-east-1. Log in, then tag and push each image:

```bash
aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin 401921623247.dkr.ecr.us-east-2.amazonaws.com
```

```bash
docker tag halloween-vision:cool 401921623247.dkr.ecr.us-east-2.amazonaws.com/halloween-vision:cool && docker push 401921623247.dkr.ecr.us-east-2.amazonaws.com/halloween-vision:cool
```

## Smoke test

`scripts/smoke.py` is an end-to-end check against a running service, with no mocks. It checks healthz, a 401 on a bad token, and a 400 on a garbage image. Then, for cosmic-cowboy, linen-ghost, and midnight-pirate, it analyzes the worn photo and checks each piece against the contract. Last, it runs `/v1/match` for each costume and checks that the costume's own product shot outscores another costume's shot. It writes an overlay for each costume to `debug/<costume>.png`, a folder git ignores.

```bash
VISION_SERVICE_TOKEN=dev-token uv run python scripts/smoke.py --url http://localhost:8080
```

The smoke test passes against both images. The linen ghost needs only 2 pieces where the other costumes need 3, because a bedsheet ghost is one sheet plus shoes and the segmenter has nothing else to find.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `VISION_SERVICE_TOKEN` | required | The bearer token for every route except `/healthz`. The service exits at startup if it is unset. |
| `VISION_WORKERS` | min(CPUs, 4) | The number of requests that can run at once. All requests share one copy of each net and take turns on it, so memory does not grow with this number. A single request peaks at about 1.7 GB RSS. |
| `VISION_MODELS_DIR` | `models/` | Where the ONNX files are. |
| `SEG_SIZE` | 512 | The segmenter's input side. |
| `OPENCV_BUILD` | unset | When set to `cool`, the build is reported as COOL. The service also detects COOL from `cv2.getBuildInformation()`. |
| `GIT_SHA` | `dev` | A build arg that shows in the logs. |

Each request writes one JSON log line: route, status, ms, build, git, timings, `n_pieces` or `n_candidates`, and whether a person was found. The logs never contain images or embeddings.

## Tuning

All thresholds are in `app/scoring.py`. A match score is 0.55 × the embedding cosine, plus 0.30 × the color score (CIEDE2000 against the piece's dominant color, capped at ΔE 40), plus 0.15 × a hue/saturation histogram correlation built from the two palettes. A score of 0.60 or more is a `match`, and 0.40 or more is `weak`. A product shot on a white background gets its foreground from GrabCut. Other product shots go through the segmenter, and if that finds nothing, a Lab threshold against the border color.

Garment phrases are ranked with a blend of two cosines: the piece crop against each phrase, and the whole look against each phrase. `CONTEXT_WEIGHT = 0.5` gives each one equal weight. The blend lets the costume theme pull the type in the right direction, for example "cowboy hat" instead of "jester cap".

Known limits:
- Pattern detection marks some solid fabrics as `patterned`.
- The ATR labels have no region for gloves or necklaces, and tights come back as `pants`.
