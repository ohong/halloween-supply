"""Match scoring. Session D tunes these constants on the eval set; nothing else lives here."""

# CLIP image-to-image cosine between the shopper's crop and the candidate crop.
# Unrelated garments land near 0.5, the same garment type near 0.8+.
EMB_FLOOR, EMB_CEIL = 0.55, 0.90
# CIEDE2000 between dominant colors. Under 10 reads as the same color, over 30 as a different one.
DELTA_E_MAX = 40.0

W_EMBEDDING = 0.55
W_COLOR = 0.30
W_HIST = 0.15

MATCH_MIN = 0.60
WEAK_MIN = 0.40

# Reason thresholds (a reason can apply even when the verdict is match).
COLOR_MISMATCH_DELTA_E = 25.0
TYPE_MISMATCH_EMBEDDING = 0.68
# Candidate photo quality.
LOW_QUALITY_MIN_SIDE = 200
LOW_QUALITY_SHARPNESS = 40.0  # variance of the Laplacian on the gray image
# Foreground under this fraction of the candidate image means no garment was found.
MIN_GARMENT_FRAC = 0.02


def _clip01(x: float) -> float:
    return max(0.0, min(1.0, x))


def score(embedding_similarity: float, color_delta_e: float, hist_similarity: float) -> float:
    emb = _clip01((embedding_similarity - EMB_FLOOR) / (EMB_CEIL - EMB_FLOOR))
    color = 1.0 - _clip01(color_delta_e / DELTA_E_MAX)
    hist = _clip01(hist_similarity)
    return W_EMBEDDING * emb + W_COLOR * color + W_HIST * hist


def verdict(s: float, reasons: list[str]) -> str:
    if "no_garment" in reasons:
        return "reject"
    if s >= MATCH_MIN and not ({"color_mismatch", "type_mismatch"} & set(reasons)):
        return "match"
    return "weak" if s >= WEAK_MIN else "reject"


# Classification (analyze): weight of the whole-look embedding next to the garment crop's own.
# 0 = crop only. 0.5 fixed cowboy hat / western boots / pirate breeches on the catalog photos.
CONTEXT_WEIGHT = 0.5
