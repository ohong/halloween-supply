"""POST /v1/match: score product photos against one analyzed piece."""

import cv2
import numpy as np

from . import colors, models, scoring
from .analyze import garment_crop, measure_colors

GRABCUT_SIDE = 320  # GrabCut runs at this long side, then the mask is scaled back up
WHITE = 235  # a pixel with all channels above this counts as studio background


def is_white_background(bgr: np.ndarray) -> bool:
    border = np.concatenate([bgr[:4].reshape(-1, 3), bgr[-4:].reshape(-1, 3),
                             bgr[:, :4].reshape(-1, 3), bgr[:, -4:].reshape(-1, 3)])
    return float(np.mean(np.all(border > WHITE, axis=1))) > 0.7


def grabcut_mask(bgr: np.ndarray) -> np.ndarray:
    """Foreground of a product shot. Seeds: near-white pixels touching the border are background,
    everything else probable foreground."""
    h, w = bgr.shape[:2]
    s = min(1.0, GRABCUT_SIDE / max(h, w))
    small = cv2.resize(bgr, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA)
    white = np.all(small > WHITE, axis=2).astype(np.uint8)
    # Background = white pixels connected to the image border (white inside the garment stays foreground).
    n, lab = cv2.connectedComponents(white, connectivity=4)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    bg = np.isin(lab, edge[edge > 0])
    gc = np.where(bg, cv2.GC_PR_BGD, cv2.GC_PR_FGD).astype(np.uint8)
    gc[cv2.erode(bg.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0] = cv2.GC_BGD
    if np.count_nonzero(gc != cv2.GC_BGD) < 50 or np.count_nonzero(gc == cv2.GC_BGD) < 50:
        m = (~bg).astype(np.uint8) * 255
    else:
        bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
        cv2.grabCut(small, gc, None, bgd, fgd, 3, cv2.GC_INIT_WITH_MASK)
        m = np.isin(gc, [cv2.GC_FGD, cv2.GC_PR_FGD]).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    return cv2.resize(m, (w, h), interpolation=cv2.INTER_NEAREST)


def threshold_mask(bgr: np.ndarray) -> np.ndarray:
    """Last resort: pixels far (in Lab) from the median border color."""
    lab = colors.bgr_to_lab(bgr)
    border = np.concatenate([lab[:4].reshape(-1, 3), lab[-4:].reshape(-1, 3),
                             lab[:, :4].reshape(-1, 3), lab[:, -4:].reshape(-1, 3)])
    d = np.linalg.norm(lab - np.median(border, axis=0), axis=2)
    m = (d > 18).astype(np.uint8) * 255
    return cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))


def low_quality(bgr: np.ndarray) -> bool:
    if min(bgr.shape[:2]) < scoring.LOW_QUALITY_MIN_SIDE:
        return True
    return cv2.Laplacian(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var() < scoring.LOW_QUALITY_SHARPNESS


def foregrounds(images: list[np.ndarray], region: str) -> list[tuple[str, np.ndarray]]:
    out: list = [None] * len(images)
    seg_idx = []
    for i, bgr in enumerate(images):
        if is_white_background(bgr):
            out[i] = ("grabcut", grabcut_mask(bgr))
        else:
            seg_idx.append(i)
    if seg_idx:
        for i, (labels, _) in zip(seg_idx, models.segment([images[i] for i in seg_idx])):
            m = np.isin(labels, models.REGION_LABELS[region]).astype(np.uint8) * 255
            worn = np.isin(labels, models.BODY_LABELS).mean() > 0.01
            if worn or np.count_nonzero(m) > scoring.MIN_GARMENT_FRAC * m.size:
                out[i] = ("segmenter", m)
            else:
                out[i] = ("threshold", threshold_mask(images[i]))
    return out


def match(piece: dict, images: list[tuple[str, np.ndarray]]) -> list[dict]:
    region = piece["region"]
    if region not in models.REGION_LABELS:
        raise ValueError(f"unknown region {region!r}")
    piece_emb = np.asarray(piece["embedding"], np.float32)
    piece_emb /= max(1e-6, float(np.linalg.norm(piece_emb)))
    piece_colors = piece.get("colors") or []
    piece_hist = colors.hs_hist_from_palette(piece_colors)

    bgrs = [b for _, b in images]
    fgs = foregrounds(bgrs, region)
    found, crops = [], []
    for (cid, bgr), (kind, m) in zip(images, fgs):
        ok = bool(np.count_nonzero(m) > scoring.MIN_GARMENT_FRAC * m.size)
        found.append(ok)
        crops.append(garment_crop(bgr, m) if ok else bgr)
    embs = models.embed(crops)

    results = []
    for (cid, bgr), (kind, m), ok, e in zip(images, fgs, found, embs):
        reasons = []
        sim = float(piece_emb @ e)
        if ok:
            pal, _ = measure_colors(bgr, m)
            hist = colors.hs_hist_from_palette(pal)
        else:
            pal, hist = [], None
            reasons.append("no_garment")
        if pal and piece_colors:
            de = float(colors.ciede2000(piece_colors[0]["lab"], pal[0]["lab"]))
            hs = float(cv2.compareHist(piece_hist, hist, cv2.HISTCMP_CORREL))
        else:
            de, hs = 100.0, 0.0
        if ok and de > scoring.COLOR_MISMATCH_DELTA_E:
            reasons.append("color_mismatch")
        if ok and sim < scoring.TYPE_MISMATCH_EMBEDDING:
            reasons.append("type_mismatch")
        if low_quality(bgr):
            reasons.append("low_quality")
        s = scoring.score(sim, de, hs)
        results.append({
            "id": cid, "garment_found": ok, "foreground": kind,
            "embedding_similarity": round(sim, 4), "color_delta_e": round(de, 2),
            "hist_similarity": round(hs, 4), "score": round(s, 4), "verdict": scoring.verdict(s, reasons),
            "reasons": reasons,
            "candidate_color": {"name": pal[0]["name"], "hex": pal[0]["hex"]} if pal else None,
        })
    return results
