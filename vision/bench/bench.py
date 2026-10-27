#!/usr/bin/env python3
"""OpenCV benchmark: COOL (Graviton) vs stock OpenCV. Needs only numpy + cv2."""
import argparse, json, os, platform, re, resource, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import cv2

REPO = Path(__file__).resolve().parents[2]
CAND_PER_IMAGE = 6
N_PIECES = 6


def rp(p):
    p = Path(p)
    return p if p.is_absolute() else REPO / p


# ---------- stats ----------
def pct(xs, q):
    s = sorted(xs)
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * q
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def summarize(ms):
    mean = sum(ms) / len(ms)
    return {"p50_ms": pct(ms, 0.5), "p95_ms": pct(ms, 0.95), "mean_ms": mean,
            "ops_s": 1000.0 / mean if mean > 0 else None, "n": len(ms)}


def timeit(fn, warmup, runs):
    for _ in range(warmup):
        fn()
    out = []
    for _ in range(runs):
        t = time.perf_counter()
        fn()
        out.append((time.perf_counter() - t) * 1000)
    return out


def cpu_now():
    r = resource.getrusage(resource.RUSAGE_SELF)
    return r.ru_utime + r.ru_stime


# ---------- environment ----------
def cpu_model():
    try:
        if sys.platform == "darwin":
            return subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"],
                                  capture_output=True, text=True, timeout=5).stdout.strip()
        found = {}
        for line in open("/proc/cpuinfo"):
            k, _, v = line.partition(":")
            k = k.strip()
            if k in ("model name", "CPU implementer", "CPU part") and k not in found:
                found[k] = v.strip()
        return "; ".join(f"{k}={v}" for k, v in found.items())
    except Exception:
        return ""


FLAG_PATTERNS = [re.compile(p, re.I) for p in
                 (r"CPU/HW features", r"Baseline", r"Dispatched code", r"Parallel framework",
                  r"Lapack", r"Eigen", r"kleidicv")] + [re.compile(r"\bHAL\b")]


def build_flag_lines(info):
    return [l.strip() for l in info.splitlines() if any(p.search(l) for p in FLAG_PATTERNS)]


def environment(args):
    info = cv2.getBuildInformation()
    return {
        "cv2_version": cv2.__version__,
        "cv2_file": getattr(cv2, "__file__", ""),
        "num_threads": cv2.getNumThreads(),
        "num_cpus_cv2": cv2.getNumberOfCPUs(),
        "os_cpu_count": os.cpu_count(),
        "machine": platform.machine(),
        "platform": platform.platform(),
        "python": sys.version.replace("\n", " "),
        "numpy": np.__version__,
        "cpu_model": cpu_model(),
        "timestamp_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }, info


# ---------- data ----------
def load_images(d):
    files = sorted(p for p in rp(d).iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    if not files:
        raise SystemExit(f"no images in {rp(d)}")
    return [p.read_bytes() for p in files], [p.name for p in files]


def make_candidates(images, cand_dir):
    """Return list (per image) of CAND_PER_IMAGE jpeg byte strings."""
    d = rp(cand_dir) if cand_dir else None
    if d and d.is_dir():
        files = sorted(p for p in d.rglob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
        if files:
            data = [p.read_bytes() for p in files]
            return [[data[(i * CAND_PER_IMAGE + j) % len(data)] for j in range(CAND_PER_IMAGE)]
                    for i in range(len(images))], "real"
    rng = np.random.default_rng(0)
    out = []
    for jb in images:
        img = cv2.imdecode(np.frombuffer(jb, np.uint8), cv2.IMREAD_COLOR)
        h, w = img.shape[:2]
        cs = []
        for _ in range(CAND_PER_IMAGE):
            f = rng.uniform(0.6, 0.9)
            ch, cw = int(h * f), int(w * f)
            y, x = rng.integers(0, h - ch + 1), rng.integers(0, w - cw + 1)
            c = img[y:y + ch, x:x + cw]
            s = rng.integers(400, 900) / max(ch, cw)
            c = cv2.resize(c, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
            shift = rng.integers(-25, 26, size=3)
            c = np.clip(c.astype(np.int16) + shift, 0, 255).astype(np.uint8)
            cs.append(cv2.imencode(".jpg", c, [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tobytes())
        out.append(cs)
    return out, "synthetic"


# ---------- micro benchmarks ----------
def find_models(onnx_args):
    paths = [Path(p) for p in (onnx_args or [])]
    if not paths:
        dirs = [REPO / "vision" / "models"]
        if os.environ.get("BENCH_MODELS_DIR"):
            dirs.insert(0, Path(os.environ["BENCH_MODELS_DIR"]))
        for d in dirs:
            for n in ("clip_vit_b32_vision.onnx", "segformer_b2_clothes.onnx"):
                if (d / n).is_file() and not any(p.name == n for p in paths):
                    paths.append(d / n)
    return paths


def dnn_op(path):
    size = 512 if "segformer" in path.name.lower() else 224
    net = cv2.dnn.readNetFromONNX(str(path))
    img = np.random.default_rng(0).integers(0, 255, (size, size, 3), dtype=np.uint8)
    blob = cv2.dnn.blobFromImage(img, 1 / 255.0, (size, size), swapRB=True)

    def fn():
        net.setInput(blob)
        net.forward()
    return fn, size


def micro(img_bytes, warmup, runs, onnx_paths, quick):
    img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img.shape[:2] != (1254, 1254):
        img = cv2.resize(img, (1254, 1254))
    f32 = img.astype(np.float32) / 255.0
    lab = cv2.cvtColor(f32, cv2.COLOR_BGR2Lab)
    pix = lab.reshape(-1, 3)
    pix = pix[np.random.default_rng(0).choice(len(pix), 20000, replace=False)].copy()
    small = cv2.resize(img, (512, 512), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h1 = cv2.calcHist([hsv], [0, 1], None, [30, 32], [0, 180, 0, 256])
    h2 = cv2.calcHist([cv2.cvtColor(small, cv2.COLOR_BGR2HSV)], [0, 1], None, [30, 32], [0, 180, 0, 256])
    jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])[1]
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)
    r = 512
    rect = (int(r * .05), int(r * .05), int(r * .9), int(r * .9))

    def km():
        cv2.setRNGSeed(0)
        cv2.kmeans(pix, 3, None, crit, 1, cv2.KMEANS_PP_CENTERS)

    def gc(iters):
        def f():
            m = np.zeros((r, r), np.uint8)
            cv2.grabCut(small, m, rect, np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64),
                        iters, cv2.GC_INIT_WITH_RECT)
        return f

    ops = {
        "resize_area_512": lambda: cv2.resize(img, (512, 512), interpolation=cv2.INTER_AREA),
        "resize_linear_2048": lambda: cv2.resize(img, (2048, 2048), interpolation=cv2.INTER_LINEAR),
        "cvtColor_BGR2Lab_f32": lambda: cv2.cvtColor(f32, cv2.COLOR_BGR2Lab),
        "cvtColor_BGR2HSV": lambda: cv2.cvtColor(img, cv2.COLOR_BGR2HSV),
        "GaussianBlur_5x5": lambda: cv2.GaussianBlur(img, (5, 5), 0),
        "kmeans_k3_20000px": km,
        "grabCut_5iter_512": gc(5),
        "Canny_100_200": lambda: cv2.Canny(gray, 100, 200),
        "calcHist_HS_30x32+compareHist": lambda: (cv2.calcHist([hsv], [0, 1], None, [30, 32], [0, 180, 0, 256]),
                                                  cv2.compareHist(h1, h2, cv2.HISTCMP_CORREL)),
        "imdecode_jpeg": lambda: cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR),
        "imencode_jpeg_q90": lambda: cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90]),
    }
    res = {}
    for name, fn in ops.items():
        try:
            res[name] = summarize(timeit(fn, warmup, runs))
        except Exception as e:
            res[name] = {"error": f"{type(e).__name__}: {e}"}
    if not onnx_paths:
        res["dnn"] = {"skipped": "no ONNX models found (use --onnx or BENCH_MODELS_DIR)"}
    for p in onnx_paths:
        name = f"dnn_forward_{p.stem}"
        try:
            t = time.perf_counter()
            fn, size = dnn_op(p)
            load_s = time.perf_counter() - t
            d_runs = max(2, min(runs, 3)) if quick else runs
            res[name] = summarize(timeit(fn, warmup, d_runs))
            res[name].update({"input_size": size, "load_s": load_s})
        except Exception as e:
            res[name] = {"error": f"{type(e).__name__}: {str(e)[:300]}"}
    return res


# ---------- cv-pipeline workload ----------
def hs_hist(hsv, mask):
    h = cv2.calcHist([hsv], [0, 1], mask, [30, 32], [0, 180, 0, 256])
    return cv2.normalize(h, h).astype(np.float32)


def analyze(jb):
    img = cv2.imdecode(np.frombuffer(jb, np.uint8), cv2.IMREAD_COLOR)
    h, w = img.shape[:2]
    s = 768.0 / max(h, w)
    if s < 1:
        img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(img.astype(np.float32) / 255.0, cv2.COLOR_BGR2Lab)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    mask = (np.min(img, axis=2) < 235).astype(np.uint8) * 255
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k)
    cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    x, y, bw, bh = cv2.boundingRect(max(cs, key=cv2.contourArea)) if cs else (0, 0, img.shape[1], img.shape[0])
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)
    pieces = []
    for i in range(N_PIECES):
        y0, y1 = y + bh * i // N_PIECES, y + bh * (i + 1) // N_PIECES
        m = mask[y0:y1, x:x + bw]
        px = lab[y0:y1, x:x + bw][m > 0]
        palette = None
        if len(px) >= 3:
            if len(px) > 20000:
                px = px[np.linspace(0, len(px) - 1, 20000).astype(int)]
            cv2.setRNGSeed(0)
            _, _, palette = cv2.kmeans(np.ascontiguousarray(px), 3, None, crit, 1, cv2.KMEANS_PP_CENTERS)
        pieces.append({"palette": palette, "hist": hs_hist(hsv[y0:y1, x:x + bw], m),
                       "lab_mean": px.mean(axis=0) if len(px) else np.zeros(3, np.float32)})
    return {"pieces": pieces}


def match(piece_info, cand_jpegs):
    scores = []
    for jb in cand_jpegs:
        img = cv2.imdecode(np.frombuffer(jb, np.uint8), cv2.IMREAD_COLOR)
        img = cv2.resize(img, (512, 512), interpolation=cv2.INTER_AREA)
        m = np.zeros((512, 512), np.uint8)
        cv2.grabCut(img, m, (25, 25, 462, 462), np.zeros((1, 65), np.float64),
                    np.zeros((1, 65), np.float64), 3, cv2.GC_INIT_WITH_RECT)
        fg = ((m == 1) | (m == 3)).astype(np.uint8) * 255
        if not fg.any():
            fg[:] = 255
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        hist = hs_hist(hsv, fg)
        lab = cv2.cvtColor(img.astype(np.float32) / 255.0, cv2.COLOR_BGR2Lab)
        mean = lab[fg > 0].mean(axis=0)
        best = max(cv2.compareHist(p["hist"], hist, cv2.HISTCMP_CORREL) for p in piece_info["pieces"])
        de = min(float(np.linalg.norm(p["lab_mean"] - mean)) for p in piece_info["pieces"])
        scores.append({"hist_correl": float(best), "delta_e76": de})
    return {"scores": scores}


def workload(images, cands, warmup, runs, analyze_fn, match_fn, with_cpu=True):
    def one():
        a, m = [], []
        infos = []
        for jb in images:
            t = time.perf_counter()
            infos.append(analyze_fn(jb))
            a.append((time.perf_counter() - t) * 1000)
        for info, cs in zip(infos, cands):
            t = time.perf_counter()
            match_fn(info, cs)
            m.append((time.perf_counter() - t) * 1000)
        return a, m

    for _ in range(min(warmup, 1)):
        one()
    A, M, walls, a_walls, cpu = [], [], [], [], 0.0
    wall_total = 0.0
    for _ in range(runs):
        c0, t0 = cpu_now(), time.perf_counter()
        a, m = one()
        w = time.perf_counter() - t0
        cpu += cpu_now() - c0
        wall_total += w
        A += a
        M += m
        walls.append(w)
        a_walls.append(sum(a) / 1000)
    n = len(images)
    return {
        "n_images": n, "cands_per_image": CAND_PER_IMAGE, "runs": runs,
        "analyze_ms_p50": pct(A, .5), "analyze_ms_p95": pct(A, .95),
        "match_ms_p50": pct(M, .5), "match_ms_p95": pct(M, .95),
        "analyze_images_per_s": n / pct(a_walls, .5),
        "full_wall_s_p50": pct(walls, .5), "full_wall_s_p95": pct(walls, .95),
        "cpu_util": cpu / wall_total / (os.cpu_count() or 1) if with_cpu else None,
    }


def service_workload(images, cands, warmup, runs):
    if os.environ.get("BENCH_SERVICE") != "1":
        return {"skipped": "BENCH_SERVICE != 1"}
    sys.path.insert(0, str(REPO / "vision"))
    try:
        from app import bench_hooks  # type: ignore
        a, m = bench_hooks.analyze, bench_hooks.match
    except Exception as e:
        return {"skipped": f"app.bench_hooks not importable: {type(e).__name__}: {e}"}
    try:
        return workload(images, cands, warmup, runs, a, m)
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}


# ---------- cost ----------
def cost(price, wl):
    if not price or "analyze_images_per_s" not in wl:
        return {"analyze_usd_per_1000": None, "analyze_match_usd_per_1000": None}
    n = wl["n_images"]
    return {"analyze_usd_per_1000": price / (wl["analyze_images_per_s"] * 3600) * 1000,
            "analyze_match_usd_per_1000": price / ((n / wl["full_wall_s_p50"]) * 3600) * 1000}


# ---------- report ----------
def f(x, d=2):
    return "n/a" if x is None else f"{x:.{d}f}"


def markdown(r):
    e, L = r["env"], []
    L.append(f"# Benchmark: {r['label']}\n")
    L.append("## Environment\n")
    L.append("| key | value |\n|---|---|")
    for k in ("cv2_version", "machine", "cpu_model", "platform", "python", "numpy", "cv2_file",
              "num_threads", "num_cpus_cv2", "os_cpu_count", "timestamp_utc"):
        L.append(f"| {k} | {str(e[k]).replace('|', '/')} |")
    L.append(f"| candidates | {r['candidates_kind']} |")
    L.append("\n## Micro-benchmarks (1254x1254 BGR)\n")
    L.append("| op | p50 ms | p95 ms | ops/s |\n|---|---:|---:|---:|")
    for k, v in r["micro"].items():
        if "error" in v or "skipped" in v:
            L.append(f"| {k} | {v.get('error') or 'skipped: ' + v['skipped']} | | |")
        else:
            L.append(f"| {k} | {f(v['p50_ms'])} | {f(v['p95_ms'])} | {f(v['ops_s'], 1)} |")
    L.append("\n## Workload\n")
    for name, w in r["workload"].items():
        if "skipped" in w or "error" in w:
            L.append(f"**{name}**: {w.get('skipped') or w.get('error')}\n")
            continue
        L.append(f"**{name}** ({w['n_images']} images, {w['cands_per_image']} candidates each, {w['runs']} runs)\n")
        L.append("| metric | value |\n|---|---:|")
        for k, lbl in (("analyze_ms_p50", "analyze ms/image p50"), ("analyze_ms_p95", "analyze ms/image p95"),
                       ("match_ms_p50", "match ms/image (6 cands) p50"), ("match_ms_p95", "match ms/image p95"),
                       ("analyze_images_per_s", "analyze images/s"),
                       ("full_wall_s_p50", "full workload wall s p50"), ("full_wall_s_p95", "full workload wall s p95"),
                       ("cpu_util", "CPU utilisation")):
            L.append(f"| {lbl} | {f(w.get(k), 3)} |")
        L.append("")
    c = r["cost"]
    L.append("## Cost\n")
    L.append(f"Instance price: {r['args']['instance_usd_per_hour'] or 'n/a'} USD/h\n")
    L.append("| metric | USD |\n|---|---:|")
    L.append(f"| per 1000 images, analyze | {f(c['analyze_usd_per_1000'], 4)} |")
    L.append(f"| per 1000 images, analyze+match | {f(c['analyze_match_usd_per_1000'], 4)} |")
    L.append("\n## Build flags\n\n```")
    L += r["build_flag_lines"]
    L.append("```")
    return "\n".join(L) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--label", default=os.environ.get("BENCH_LABEL", "local"))
    ap.add_argument("--instance-usd-per-hour", type=float,
                    default=float(os.environ.get("BENCH_INSTANCE_USD_PER_HOUR", 0) or 0))
    ap.add_argument("--warmup", type=int, default=3)
    ap.add_argument("--runs", type=int, default=10)
    ap.add_argument("--out", default="vision/bench/out")
    ap.add_argument("--images", default="eval/fixtures/editorial")
    ap.add_argument("--candidates", default="eval/fixtures/candidates")
    ap.add_argument("--threads", type=int, default=None)
    ap.add_argument("--onnx", action="append", default=None, help="repeatable; default: auto-find models")
    ap.add_argument("--workload-runs", type=int, default=3,
                    help="runs of the 25-image workload (GrabCut makes each run slow); default 3")
    ap.add_argument("--quick", action="store_true", help="cap dnn runs and workload runs at 2-3")
    args = ap.parse_args()

    if args.threads:
        cv2.setNumThreads(args.threads)
    env, info = environment(args)
    images, names = load_images(args.images)
    cands, ckind = make_candidates(images, args.candidates)
    runs = min(args.runs, 3) if args.quick else args.runs
    wruns = min(args.workload_runs, 2) if args.quick else args.workload_runs

    t0 = time.time()
    r = {"label": args.label, "args": vars(args), "env": env, "candidates_kind": ckind,
         "image_files": names, "build_info": info, "build_flag_lines": build_flag_lines(info)}
    r["micro"] = micro(images[0], args.warmup, runs, find_models(args.onnx), args.quick)
    wl = {}
    try:
        wl["cv_pipeline"] = workload(images, cands, args.warmup, wruns, analyze, match)
    except Exception as e:
        wl["cv_pipeline"] = {"error": f"{type(e).__name__}: {e}"}
    wl["service"] = service_workload(images, cands, args.warmup, wruns)
    r["workload"] = wl
    r["cost"] = cost(args.instance_usd_per_hour, wl["cv_pipeline"])
    r["total_bench_s"] = time.time() - t0

    out = rp(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{args.label}.json").write_text(json.dumps(r, indent=2))
    (out / f"{args.label}.md").write_text(markdown(r))
    cp = wl["cv_pipeline"]
    errs = [k for k, v in r["micro"].items() if "error" in v]
    print(f"[{args.label}] cv2 {env['cv2_version']} {env['machine']} threads={env['num_threads']} "
          f"total={r['total_bench_s']:.0f}s")
    if "error" in cp:
        print("cv-pipeline error:", cp["error"])
    else:
        print(f"analyze p50 {cp['analyze_ms_p50']:.1f} ms, match p50 {cp['match_ms_p50']:.1f} ms, "
              f"full workload p50 {cp['full_wall_s_p50']:.2f} s, cpu_util {cp['cpu_util']:.2f}")
    if errs:
        print("micro errors:", ", ".join(errs))
    print(f"wrote {out / (args.label + '.json')} and .md")


if __name__ == "__main__":
    main()
