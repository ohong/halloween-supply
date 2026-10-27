# COOL vs stock OpenCV

Baseline for speedup: `stock-mac-arm64`. Speedup above 1.00x means faster than baseline.

## Status: COOL and AWS runs blocked (2026-10-26)

Only the Mac arm64 stock baseline below has been measured. The COOL-on-Graviton, stock-on-Graviton and stock-on-x86 runs did not happen before the 20:30 PT cutoff, for two reasons:

- The AWS account is on the Free plan, which rejects `c8g.xlarge` and `c7i.xlarge` ("not eligible for Free Tier") and Marketplace AMIs.
- The COOL Graviton4 AMI subscription is not yet accepted.

So this file has no COOL numbers and makes no COOL speedup claim. To finish, upgrade the account, subscribe to the COOL AMI, run `cd infra && ./60-bench-instances.sh up` on branch `oh-cv-aws` (it starts stock c8g, COOL c8g and stock c7i, reachable over SSM only), then run `bench.py` on each host as `vision/bench/README.md` describes. Copy the JSON files back through `s3://halloween-vision-bench-401921623247` into `vision/bench/out/` and run `python3 vision/bench/compare.py`.

## Environment

| key | stock-mac-arm64 |
|---|---|
| cv2_version | 5.0.0 |
| machine | arm64 |
| cpu_model | Apple M5 Pro |
| num_threads | 15 |
| os_cpu_count | 15 |
| numpy | 2.5.4 |
| candidates | synthetic |

## Micro-benchmarks

| metric | stock-mac-arm64 |
|---|---|
| resize_area_512 (p50 ms) | 4.20 |
| resize_linear_2048 (p50 ms) | 0.79 |
| cvtColor_BGR2Lab_f32 (p50 ms) | 0.74 |
| cvtColor_BGR2HSV (p50 ms) | 0.22 |
| GaussianBlur_5x5 (p50 ms) | 0.59 |
| kmeans_k3_20000px (p50 ms) | 1.20 |
| grabCut_5iter_512 (p50 ms) | 324.23 |
| Canny_100_200 (p50 ms) | 1.29 |
| calcHist_HS_30x32+compareHist (p50 ms) | 3.46 |
| imdecode_jpeg (p50 ms) | 2.94 |
| imencode_jpeg_q90 (p50 ms) | 3.15 |
| dnn_forward_clip_vit_b32_vision (p50 ms) | 33.79 |
| dnn_forward_segformer_b2_clothes (p50 ms) | 1780.53 |

## Workload

| metric | stock-mac-arm64 |
|---|---|
| cv_pipeline: analyze ms/image p50 | 62.374 |
| cv_pipeline: analyze ms/image p95 | 132.663 |
| cv_pipeline: match ms/image p50 | 4318.952 |
| cv_pipeline: match ms/image p95 | 18428.017 |
| cv_pipeline: analyze images/s | 10.499 |
| cv_pipeline: full workload s p50 | 168.929 |
| cv_pipeline: full workload s p95 | 176.723 |
| cv_pipeline: CPU utilisation | 0.051 |

## Cost

| metric | stock-mac-arm64 |
|---|---|
| USD per 1000 images (analyze) | n/a |
| USD per 1000 images (analyze+match) | n/a |
| instance USD/h | n/a |
