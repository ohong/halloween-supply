# COOL vs stock OpenCV

Baseline for speedup: `stock-mac-arm64`. Speedup above 1.00x means faster than baseline.

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
