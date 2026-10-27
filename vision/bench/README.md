# OpenCV benchmark: COOL vs stock

Compares COOL (Cloud Optimized OpenCV on AWS Graviton), stock `opencv-python-headless==5.0.0.93` on the same Graviton host, and stock on x86 c7i.xlarge. Only numpy + cv2 are needed.

**What it measures**
- Micro-ops on a 1254x1254 image: resize, cvtColor (Lab/HSV), GaussianBlur, kmeans, GrabCut, Canny, calcHist/compareHist, JPEG decode/encode, and ONNX `dnn` forward for the CLIP and SegFormer models if found.
- Workload `cv_pipeline`: per-image analyze (decode, resize, Lab, mask, contours, 6 piece palettes + hists) and match (6 candidates: GrabCut, hist, delta_e76) over the 25 editorial images; wall time per run, images/s, CPU utilisation, $/1000 images.
- Workload `service`: only if `BENCH_SERVICE=1` and `vision/app/bench_hooks.py` exposes `analyze(jpeg_bytes)` and `match(piece, candidate_jpegs)`.

**Run**
```
# local stock (example: Mac)
uv run --with numpy --with opencv-python-headless==5.0.0.93 python vision/bench/bench.py --label stock-mac-arm64
# COOL host (venv may also be /opt/cool/venvs/python_3.12/bin/python)
PYTHONPATH=/opt/cool/python_3.12/site-packages LD_LIBRARY_PATH=/opt/cool/cpp_sdk/lib python3 vision/bench/bench.py --label cool-graviton --instance-usd-per-hour <price>
# stock on Graviton / x86: same uv command with --label stock-graviton / stock-x86 and --instance-usd-per-hour
python3 vision/bench/compare.py   # reads out/*.json, writes out/cool.md
```
Useful flags: `--warmup 3 --runs 10` (micro-ops), `--workload-runs 3` (GrabCut makes each workload run slow), `--quick`, `--threads N`, `--onnx PATH` (repeatable), env `BENCH_MODELS_DIR` (dir with `clip_vit_b32_vision.onnx`, `segformer_b2_clothes.onnx`; default `vision/models`).

**Limitations**
- If `eval/fixtures/candidates` is absent, candidates are synthesized (seeded crops, rescales, colour shifts) and marked `synthetic` in the output.
- `cv_pipeline` approximates the service's OpenCV work; it is not the service itself.
- A dnn model that fails to load in OpenCV is recorded as an error, not a crash.
