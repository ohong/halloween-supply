#!/usr/bin/env python3
"""Read <out>/*.json from bench.py and write <out>/cool.md. Stdlib only."""
import json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
out = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "vision/bench/out"
runs = [json.loads(p.read_text()) for p in sorted(out.glob("*.json"))]
if not runs:
    raise SystemExit(f"no json in {out}")
labels = [r["label"] for r in runs]
base = "stock-graviton" if "stock-graviton" in labels else labels[0]
R = {r["label"]: r for r in runs}
others = [l for l in labels if l != base]


def fmt(x, d=2):
    return "n/a" if x is None else f"{x:.{d}f}"


def table(title, rows, d=2):
    """rows: (name, {label: value}, lower_is_better)"""
    head = ["metric"] + labels + [f"{l} vs {base}" for l in others]
    L = [f"## {title}\n", "| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for name, vals, lower in rows:
        cells = [name] + [fmt(vals.get(l), d) for l in labels]
        for l in others:
            b, v = vals.get(base), vals.get(l)
            if b and v:
                cells.append(f"{(b / v if lower else v / b):.2f}x")
            else:
                cells.append("n/a")
        L.append("| " + " | ".join(cells) + " |")
    return "\n".join(L) + "\n"


md = [f"# COOL vs stock OpenCV\n\nBaseline for speedup: `{base}`. Speedup above 1.00x means faster than baseline.\n"]
# out/STATUS.md (hand-written) explains which hosts are missing and why; it survives regeneration.
if (out / "STATUS.md").exists():
    md.append((out / "STATUS.md").read_text())
env_rows = ["cv2_version", "machine", "cpu_model", "num_threads", "os_cpu_count", "numpy"]
L = ["## Environment\n", "| key | " + " | ".join(labels) + " |", "|---|" + "---|" * len(labels)]
for k in env_rows:
    L.append(f"| {k} | " + " | ".join(str(R[l]["env"].get(k, "")).replace("|", "/") for l in labels) + " |")
L.append("| candidates | " + " | ".join(R[l].get("candidates_kind", "") for l in labels) + " |")
md.append("\n".join(L) + "\n")

ops = []
for r in runs:
    for k in r["micro"]:
        if k not in ops:
            ops.append(k)
rows = []
for op in ops:
    vals = {l: R[l]["micro"].get(op, {}).get("p50_ms") for l in labels}
    rows.append((op + " (p50 ms)", vals, True))
md.append(table("Micro-benchmarks", rows))
errs = [(l, op, v["error"]) for l in labels for op, v in R[l]["micro"].items() if "error" in v]
if errs:
    md.append("Errors:\n\n" + "\n".join(f"- {l} / {op}: {e}" for l, op, e in errs) + "\n")

wl_rows = []
for part in ("cv_pipeline", "service"):
    def g(l, k):
        return R[l]["workload"].get(part, {}).get(k)
    if not any(g(l, "n_images") for l in labels):
        continue
    for k, lbl, lower in (("analyze_ms_p50", "analyze ms/image p50", True),
                          ("analyze_ms_p95", "analyze ms/image p95", True),
                          ("match_ms_p50", "match ms/image p50", True),
                          ("match_ms_p95", "match ms/image p95", True),
                          ("analyze_images_per_s", "analyze images/s", False),
                          ("full_wall_s_p50", "full workload s p50", True),
                          ("full_wall_s_p95", "full workload s p95", True),
                          ("cpu_util", "CPU utilisation", False)):
        wl_rows.append((f"{part}: {lbl}", {l: g(l, k) for l in labels}, lower))
md.append(table("Workload", wl_rows, 3))

cost_rows = []
for k, lbl in (("analyze_usd_per_1000", "USD per 1000 images (analyze)"),
               ("analyze_match_usd_per_1000", "USD per 1000 images (analyze+match)")):
    cost_rows.append((lbl, {l: R[l]["cost"].get(k) for l in labels}, True))
cost_rows.append(("instance USD/h", {l: R[l]["args"].get("instance_usd_per_hour") or None for l in labels}, True))
md.append(table("Cost", cost_rows, 4))

(out / "cool.md").write_text("\n".join(md))
print(f"wrote {out / 'cool.md'} ({len(labels)} labels, baseline {base})")
