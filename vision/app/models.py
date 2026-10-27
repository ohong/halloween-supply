"""The two cv2.dnn networks (SegFormer clothes parser, CLIP image encoder) and the vocabulary.

Every forward pass goes through cv2.dnn. A cv2.dnn.Net is not thread-safe, so each
worker thread gets its own copy of each net.
"""

import hashlib
import json
import os
import threading
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MODELS = Path(os.environ.get("VISION_MODELS_DIR", ROOT / "models"))
SEGMENTER_FILE = "segformer_b2_clothes.onnx"
EMBEDDER_FILE = "clip_vit_b32_vision.onnx"

# SegFormer ATR labels (mattmdjaga/segformer_b2_clothes config.json).
LABELS = ["background", "hat", "hair", "sunglasses", "upper_clothes", "skirt", "pants", "dress", "belt",
          "left_shoe", "right_shoe", "face", "left_leg", "right_leg", "left_arm", "right_arm", "bag", "scarf"]
# Contract regions -> segmenter label ids. Left and right shoes merge into one piece.
REGION_LABELS = {
    "hat": [1], "sunglasses": [3], "upper_clothes": [4], "dress": [7], "skirt": [5], "pants": [6],
    "belt": [8], "shoes": [9, 10], "bag": [16], "scarf": [17],
}
BODY_LABELS = [2, 11, 12, 13, 14, 15]  # hair, face, legs, arms: visible skin means a person wears it

SEG_SIZE = int(os.environ.get("SEG_SIZE", "512"))
SEG_MEAN, SEG_STD = np.array([0.485, 0.456, 0.406]), np.array([0.229, 0.224, 0.225])
CLIP_MEAN, CLIP_STD = np.array([0.48145466, 0.4578275, 0.40821073]), np.array([0.26862954, 0.26130258, 0.27577711])


def _fingerprint(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return f"{path.name}@{h.hexdigest()[:12]}"


FINGERPRINTS = {"segmenter": _fingerprint(MODELS / SEGMENTER_FILE), "embedder": _fingerprint(MODELS / EMBEDDER_FILE)}

VOCAB = json.loads((ROOT / "vocabulary.json").read_text())
VOCAB_EMB = np.load(ROOT / "vocabulary.npy").astype(np.float32)
assert VOCAB_EMB.shape == (len(VOCAB), 512), "vocabulary.npy is stale; rerun scripts/embed_vocabulary.py"
VOCAB_BY_REGION = {r: np.array([i for i, v in enumerate(VOCAB) if v["region"] == r]) for r in REGION_LABELS}
VOCAB_INDEX = {(v["phrase"], v["region"]): i for i, v in enumerate(VOCAB)}

_local = threading.local()


def _nets():
    if not hasattr(_local, "seg"):
        _local.seg = cv2.dnn.readNet(str(MODELS / SEGMENTER_FILE))
        _local.clip = cv2.dnn.readNet(str(MODELS / EMBEDDER_FILE))
    return _local.seg, _local.clip


def segment(bgr_images: list[np.ndarray]) -> list[tuple[np.ndarray, np.ndarray]]:
    """Per image: (label map uint8 HxW, confidence of the winning label float32 HxW)."""
    seg, _ = _nets()
    blobs = []
    for bgr in bgr_images:
        rgb = cv2.cvtColor(cv2.resize(bgr, (SEG_SIZE, SEG_SIZE), interpolation=cv2.INTER_LINEAR), cv2.COLOR_BGR2RGB)
        blobs.append(((rgb.astype(np.float32) / 255.0 - SEG_MEAN) / SEG_STD).transpose(2, 0, 1))
    seg.setInput(np.stack(blobs).astype(np.float32))
    logits = seg.forward()  # N x 18 x S/4 x S/4
    out = []
    for bgr, lg in zip(bgr_images, logits):
        h, w = bgr.shape[:2]
        up = cv2.resize(lg.transpose(1, 2, 0), (w, h), interpolation=cv2.INTER_LINEAR)  # HxWx18
        up -= up.max(axis=2, keepdims=True)
        np.exp(up, out=up)
        prob = up.max(axis=2) / up.sum(axis=2)
        out.append((up.argmax(axis=2).astype(np.uint8), prob.astype(np.float32)))
    return out


def clip_blob(bgr: np.ndarray) -> np.ndarray:
    """Pad to a white square (so tall pants or wide hats are not cut off), resize to 224."""
    h, w = bgr.shape[:2]
    s = max(h, w)
    sq = np.full((s, s, 3), 255, np.uint8)
    sq[(s - h) // 2:(s - h) // 2 + h, (s - w) // 2:(s - w) // 2 + w] = bgr
    rgb = cv2.cvtColor(cv2.resize(sq, (224, 224), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
    return ((rgb.astype(np.float32) / 255.0 - CLIP_MEAN) / CLIP_STD).transpose(2, 0, 1).astype(np.float32)


def embed(bgr_crops: list[np.ndarray]) -> np.ndarray:
    """L2-normalized CLIP image embeddings, N x 512."""
    if not bgr_crops:
        return np.zeros((0, 512), np.float32)
    _, clip = _nets()
    clip.setInput(np.stack([clip_blob(c) for c in bgr_crops]))
    e = clip.forward().astype(np.float32)
    return e / np.linalg.norm(e, axis=1, keepdims=True)


def classify(embedding: np.ndarray, region: str, top: int = 3, context: np.ndarray | None = None,
             context_weight: float = 0.0) -> list[tuple[int, float]]:
    """Top vocabulary entries for this region: [(vocab index, score)]. The score is the cosine with the
    garment crop, blended with the cosine against the whole look (context) so a silver hat on a cowboy
    reads as a cowboy hat rather than a jester cap."""
    idx = VOCAB_BY_REGION[region]
    if len(idx) == 0:
        return []
    sims = VOCAB_EMB[idx] @ embedding
    if context is not None and context_weight:
        sims = (sims + context_weight * (VOCAB_EMB[idx] @ context)) / (1 + context_weight)
    order = np.argsort(-sims)[:top]
    return [(int(idx[i]), float(sims[i])) for i in order]
