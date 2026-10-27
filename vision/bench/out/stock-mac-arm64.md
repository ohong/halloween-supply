# Benchmark: stock-mac-arm64

## Environment

| key | value |
|---|---|
| cv2_version | 5.0.0 |
| machine | arm64 |
| cpu_model | Apple M5 Pro |
| platform | macOS-27.2-arm64-arm-64bit-Mach-O |
| python | 3.13.7 (main, Sep  2 2025, 14:05:52) [Clang 20.1.4 ] |
| numpy | 2.5.4 |
| cv2_file | /Users/ohong/.cache/uv/archive-v0/JM4ApoBEErcLYzeE/lib/python3.13/site-packages/cv2/__init__.py |
| num_threads | 15 |
| num_cpus_cv2 | 15 |
| os_cpu_count | 15 |
| timestamp_utc | 2026-10-27T00:04:52+00:00 |
| candidates | synthetic |

## Micro-benchmarks (1254x1254 BGR)

| op | p50 ms | p95 ms | ops/s |
|---|---:|---:|---:|
| resize_area_512 | 4.20 | 4.22 | 251.2 |
| resize_linear_2048 | 0.79 | 0.82 | 1267.4 |
| cvtColor_BGR2Lab_f32 | 0.74 | 0.80 | 1329.2 |
| cvtColor_BGR2HSV | 0.22 | 0.64 | 2674.4 |
| GaussianBlur_5x5 | 0.59 | 0.65 | 1897.5 |
| kmeans_k3_20000px | 1.20 | 1.23 | 859.8 |
| grabCut_5iter_512 | 324.23 | 337.82 | 3.0 |
| Canny_100_200 | 1.29 | 1.34 | 890.1 |
| calcHist_HS_30x32+compareHist | 3.46 | 3.49 | 292.7 |
| imdecode_jpeg | 2.94 | 3.15 | 333.6 |
| imencode_jpeg_q90 | 3.15 | 3.31 | 317.2 |
| dnn_forward_clip_vit_b32_vision | 33.79 | 34.31 | 30.1 |
| dnn_forward_segformer_b2_clothes | 1780.53 | 1803.90 | 0.6 |

## Workload

**cv_pipeline** (25 images, 6 candidates each, 3 runs)

| metric | value |
|---|---:|
| analyze ms/image p50 | 62.374 |
| analyze ms/image p95 | 132.663 |
| match ms/image (6 cands) p50 | 4318.952 |
| match ms/image p95 | 18428.017 |
| analyze images/s | 10.499 |
| full workload wall s p50 | 168.929 |
| full workload wall s p95 | 176.723 |
| CPU utilisation | 0.051 |

**service**: BENCH_SERVICE != 1

## Cost

Instance price: n/a USD/h

| metric | USD |
|---|---:|
| per 1000 images, analyze | n/a |
| per 1000 images, analyze+match | n/a |

## Build flags

```
CPU/HW features:
Baseline:                    NEON FP16 NEON_DOTPROD NEON_FP16
Dispatched code generation:  NEON_BF16
3rdparty dependencies:       ittnotify libprotobuf libjpeg-turbo libwebp libpng libtiff libopenjp2 zlib tegra_hal kleidicv_hal kleidicv kleidicv_thread
Parallel framework:            GCD
Lapack:                      YES (Apple -framework Accelerate)
Eigen:                       NO
Custom HAL:                  YES (carotene (ver 0.0.1) KleidiCV (ver 26.03))
```
