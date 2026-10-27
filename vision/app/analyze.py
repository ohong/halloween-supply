"""POST /v1/analyze: one costume photo -> garment pieces with colors, types and embeddings."""

import time

import cv2
import numpy as np

from . import colors, models, scoring
from .imageio import encode_jpeg_b64

MIN_AREA_FRAC = 0.005
# Words that name a costume theme. The title uses the first one found in the strongest phrase.
THEMES = ["cowboy", "cowgirl", "pirate", "witch", "wizard", "ghost", "vampire", "mummy", "zombie", "skeleton",
          "astronaut", "space", "robot", "superhero", "ninja", "knight", "princess", "fairy", "angel", "devil",
          "cat", "bunny", "musketeer", "sailor", "detective", "nurse", "doctor", "chef", "clown", "flapper",
          "hippie", "disco", "punk", "gothic", "victorian", "medieval", "safari", "aviator", "pilot", "cosmic",
          "western", "military", "steampunk", "mermaid", "jester", "monk", "samurai", "viking", "toga", "cape"]


def _bbox(mask: np.ndarray) -> list[int]:
    x, y, w, h = cv2.boundingRect(mask)
    return [int(x), int(y), int(w), int(h)]


def _clean(mask: np.ndarray) -> np.ndarray:
    """Drop specks: keep connected components at least 10% the size of the largest."""
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n <= 2:
        return mask
    areas = stats[1:, cv2.CC_STAT_AREA]
    keep = np.flatnonzero(areas >= 0.1 * areas.max()) + 1
    return np.isin(lab, keep).astype(np.uint8) * 255


def garment_crop(bgr: np.ndarray, mask: np.ndarray, pad: float = 0.08) -> np.ndarray:
    """The garment pixels on white, cropped to its bbox plus padding."""
    x, y, w, h = cv2.boundingRect(mask)
    p = int(max(w, h) * pad)
    x0, y0 = max(0, x - p), max(0, y - p)
    x1, y1 = min(bgr.shape[1], x + w + p), min(bgr.shape[0], y + h + p)
    m = cv2.dilate(mask, np.ones((5, 5), np.uint8))[y0:y1, x0:x1]
    soft = cv2.GaussianBlur(m, (5, 5), 0).astype(np.float32)[..., None] / 255.0
    return (bgr[y0:y1, x0:x1].astype(np.float32) * soft + 255.0 * (1 - soft)).astype(np.uint8)


def measure_colors(bgr: np.ndarray, mask: np.ndarray) -> tuple[list[dict], str]:
    inner = cv2.erode(mask, np.ones((3, 3), np.uint8))
    if np.count_nonzero(inner) < 100:
        inner = mask
    pal = colors.palette(bgr, inner)
    return pal, ("patterned" if colors.is_patterned(bgr, mask, pal) else "solid")


def person(labels: np.ndarray, prob: np.ndarray) -> dict:
    fg = (labels > 0).astype(np.uint8) * 255
    if np.count_nonzero(fg) < 0.01 * fg.size:
        return {"found": False, "bbox": [0, 0, 0, 0], "confidence": 0.0}
    # Join a person's pieces (arms split from the torso by a bag strap) before finding the largest blob.
    joined = cv2.dilate(fg, np.ones((15, 15), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(joined, connectivity=8)
    big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    main = (lab == big) & (fg > 0)
    share = np.count_nonzero(main) / np.count_nonzero(fg)
    conf = float(prob[main].mean()) * share
    return {"found": True, "bbox": _bbox(main.astype(np.uint8)), "confidence": round(conf, 3)}


def title(pieces: list[dict]) -> str:
    ranked = sorted((p for p in pieces if p["garment_types"]), key=lambda p: -p["garment_types"][0]["score"])
    for p in ranked:
        for word in p["garment_types"][0]["phrase"].split():
            if word in THEMES:
                return f"{word.capitalize()} look"
    if ranked:
        return f"{ranked[0]['garment_types'][0]['phrase'].split()[-1].capitalize()} look"
    return "Costume look"


def analyze(bgr: np.ndarray, max_pieces: int = 8) -> dict:
    t = {}
    t0 = time.perf_counter()
    labels, prob = models.segment([bgr])[0]
    t["segment"] = time.perf_counter() - t0
    who = person(labels, prob)
    area = labels.size

    t0 = time.perf_counter()
    found = []
    for region, ids in models.REGION_LABELS.items():
        m = np.isin(labels, ids).astype(np.uint8) * 255
        if np.count_nonzero(m) < MIN_AREA_FRAC * area:
            continue
        m = _clean(cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)))
        frac = np.count_nonzero(m) / area
        if frac < MIN_AREA_FRAC:
            continue
        pal, pattern = measure_colors(bgr, m)
        if not pal:
            continue
        found.append({"region": region, "mask": m, "area_frac": frac, "colors": pal, "pattern": pattern})
    found = sorted(found, key=lambda f: -f["area_frac"])[:max_pieces]
    t["colors"] = time.perf_counter() - t0

    t0 = time.perf_counter()
    crops = [garment_crop(bgr, f["mask"]) for f in found]
    look = garment_crop(bgr, (labels > 0).astype(np.uint8) * 255) if who["found"] else bgr
    embs = models.embed([look] + crops) if crops else np.zeros((1, 512), np.float32)
    context, embs = embs[0], embs[1:]
    t["embed"] = time.perf_counter() - t0

    t0 = time.perf_counter()
    pieces = []
    for f, crop, e in zip(found, crops, embs):
        types = []
        for i, s in models.classify(e, f["region"], context=context,
                                     context_weight=scoring.CONTEXT_WEIGHT):
            v = models.VOCAB[i]
            types.append({"phrase": v["phrase"], "score": round(s, 4), "size_kind": v["size_kind"],
                          "alternate": v["alternate"], "assembly": v["assembly"]})
        top = models.VOCAB[models.VOCAB_INDEX[(types[0]["phrase"], f["region"])]]
        color = f["colors"][0]["name"]
        plain = "plain " if f["pattern"] == "solid" and top["slot"] == "top" else ""
        pieces.append({
            "region": f["region"], "slot": top["slot"], "bbox": _bbox(f["mask"]),
            "area_frac": round(f["area_frac"], 4), "colors": f["colors"], "pattern": f["pattern"],
            "garment_types": types, "query": f"{plain}{color} {top['phrase']}",
            "alternate": f"{color} {top['alternate']}", "size_kind": top["size_kind"],
            "assembly": top["assembly"], "embedding": [round(float(x), 6) for x in e],
            "crop_b64": encode_jpeg_b64(crop),
        })
    # Head to toe by the vertical center of each piece.
    pieces.sort(key=lambda p: p["bbox"][1] + p["bbox"][3] / 2)
    for i, p in enumerate(pieces):
        p["id"] = f"p{i}"
    t["classify"] = time.perf_counter() - t0
    return {"person": who, "pieces": [{"id": p.pop("id"), **p} for p in pieces], "title": title(pieces),
            "timings": t, "labels": labels}
