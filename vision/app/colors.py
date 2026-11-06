"""Color measurement: k-means in Lab, CIEDE2000, and retail color names."""

import cv2
import numpy as np

# Retail color names with sRGB hex. Names are what shoppers type into a search box.
COLOR_TABLE = {
    "black": "#111111", "charcoal": "#36454f", "gray": "#808080", "silver": "#c0c0c0",
    "white": "#f8f8f8", "ivory": "#f3eedb", "cream": "#e8dcc0", "beige": "#d6c3a0",
    "tan": "#c19a6b", "camel": "#a8783e", "brown": "#6b4423", "chocolate": "#3f2a1d",
    "burgundy": "#6d1a2a", "red": "#c62828", "coral": "#f0806a", "pink": "#f2a2bd",
    "hot pink": "#e0338a", "magenta": "#b3207d", "purple": "#6a2c91", "lavender": "#b6a3d6",
    "navy": "#1f2a4d", "blue": "#2457c5", "light blue": "#9cc3e6", "teal": "#1c7c7d",
    "turquoise": "#38c6c0", "green": "#2e7d32", "olive": "#6b6b2a", "sage": "#a3b18a",
    "mint": "#a8e6cf", "yellow": "#f4d03f", "mustard": "#c9a227", "gold": "#c8a24a",
    "orange": "#ec7a1c", "rust": "#a5461f",
}


def bgr_to_lab(bgr: np.ndarray) -> np.ndarray:
    """uint8 BGR (any shape ending in 3) -> float32 CIE Lab with L in 0..100."""
    shape = bgr.shape
    px = bgr.reshape(-1, 1, 3).astype(np.float32) / 255.0
    return cv2.cvtColor(px, cv2.COLOR_BGR2Lab).reshape(shape).astype(np.float32)


def lab_to_bgr(lab) -> np.ndarray:
    px = np.asarray(lab, np.float32).reshape(1, 1, 3)
    return np.clip(cv2.cvtColor(px, cv2.COLOR_Lab2BGR) * 255.0 + 0.5, 0, 255).astype(np.uint8).reshape(3)


def lab_to_hex(lab) -> str:
    b, g, r = lab_to_bgr(lab)
    return f"#{r:02x}{g:02x}{b:02x}"


def hex_to_lab(hx: str) -> np.ndarray:
    r, g, b = (int(hx[i:i + 2], 16) for i in (1, 3, 5))
    return bgr_to_lab(np.array([[b, g, r]], np.uint8))[0]


def ciede2000(lab1, lab2) -> np.ndarray:
    """CIEDE2000 color difference. Broadcasts over leading dimensions."""
    lab1, lab2 = np.asarray(lab1, np.float64), np.asarray(lab2, np.float64)
    L1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    L2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2)
    Cm = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cm**7 / (Cm**7 + 25.0**7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    dhp = h2p - h1p
    dhp = np.where(dhp > 180, dhp - 360, np.where(dhp < -180, dhp + 360, dhp))
    dhp = np.where(C1p * C2p == 0, 0, dhp)
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dhp) / 2)
    Lpm, Cpm = (L1 + L2) / 2, (C1p + C2p) / 2
    hsum = h1p + h2p
    hpm = np.where(np.abs(h1p - h2p) > 180, np.where(hsum < 360, hsum + 360, hsum - 360), hsum) / 2
    hpm = np.where(C1p * C2p == 0, hsum, hpm)
    T = (1 - 0.17 * np.cos(np.radians(hpm - 30)) + 0.24 * np.cos(np.radians(2 * hpm))
         + 0.32 * np.cos(np.radians(3 * hpm + 6)) - 0.20 * np.cos(np.radians(4 * hpm - 63)))
    dtheta = 30 * np.exp(-(((hpm - 275) / 25) ** 2))
    Rc = 2 * np.sqrt(Cpm**7 / (Cpm**7 + 25.0**7))
    Sl = 1 + 0.015 * (Lpm - 50) ** 2 / np.sqrt(20 + (Lpm - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cpm, 1 + 0.015 * Cpm * T
    Rt = -np.sin(np.radians(2 * dtheta)) * Rc
    return np.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))


_NAMES = list(COLOR_TABLE)
_TABLE_LAB = np.stack([hex_to_lab(h) for h in COLOR_TABLE.values()])


def color_name(lab) -> str:
    return _NAMES[int(np.argmin(ciede2000(_TABLE_LAB, np.asarray(lab)[None])))]


def palette(bgr: np.ndarray, mask: np.ndarray, k: int = 3, max_px: int = 20000) -> list[dict]:
    """Dominant colors of the masked pixels, largest first: [{name, hex, lab, frac}].

    Clusters closer than ΔE 8 are merged so a flat garment reports one color.
    """
    px = bgr[mask > 0]
    if len(px) < k * 10:
        return []
    if len(px) > max_px:
        px = px[np.random.default_rng(0).choice(len(px), max_px, replace=False)]
    lab = bgr_to_lab(px)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5)
    cv2.setRNGSeed(0)
    _, labels, centers = cv2.kmeans(lab, k, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(labels.ravel(), minlength=k).astype(np.float64)
    clusters = sorted(zip(counts / counts.sum(), centers), key=lambda c: -c[0])
    merged: list[list] = []
    for frac, c in clusters:
        for m in merged:
            if ciede2000(m[1], c) < 8:
                m[1] = (m[1] * m[0] + c * frac) / (m[0] + frac)
                m[0] += frac
                break
        else:
            merged.append([frac, c.astype(np.float64)])
    merged.sort(key=lambda m: -m[0])
    return [
        {"name": color_name(c), "hex": lab_to_hex(c), "lab": [round(float(v), 1) for v in c], "frac": round(float(f), 3)}
        for f, c in merged
    ]


def hs_hist_from_palette(colors: list[dict]) -> np.ndarray:
    """Hue-saturation histogram of a palette, so a piece (which carries only its palette)
    and a candidate compare like for like with cv2.compareHist."""
    if not colors:
        return np.zeros((30, 32), np.float32)
    n = 400
    counts = np.maximum(1, np.round(np.array([c["frac"] for c in colors]) * n).astype(int))
    bgr = np.concatenate([np.tile(lab_to_bgr(c["lab"]), (k, 1)) for c, k in zip(colors, counts)])
    return hs_hist(bgr.reshape(-1, 1, 3), None)


def hs_hist(bgr: np.ndarray, mask) -> np.ndarray:
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h = cv2.calcHist([hsv], [0, 1], mask, [30, 32], [0, 180, 0, 256])
    h = cv2.GaussianBlur(h, (5, 5), 1.0)  # tolerate small hue shifts between photos
    cv2.normalize(h, h, 1.0, 0, cv2.NORM_L1)
    return h


def is_patterned(bgr: np.ndarray, mask: np.ndarray, colors: list[dict]) -> bool:
    if len(colors) >= 2 and colors[1]["frac"] > 0.25 and ciede2000(colors[0]["lab"], colors[1]["lab"]) > 20:
        return True
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 60, 160)
    inner = cv2.erode(mask, np.ones((7, 7), np.uint8))
    n = int(np.count_nonzero(inner))
    return n > 200 and np.count_nonzero(edges[inner > 0]) / n > 0.15
