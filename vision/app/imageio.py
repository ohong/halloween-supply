"""Decode and encode images. Errors here are the caller's fault, so they raise BadImage."""

import base64
import binascii

import cv2
import numpy as np

MAX_DECODED_BYTES = 4 * 1024 * 1024
MAX_SIDE = 1024


class BadImage(ValueError):
    pass


class TooLarge(ValueError):
    pass


def b64_bytes(s: str) -> bytes:
    if "," in s[:100] and s.startswith("data:"):
        s = s.split(",", 1)[1]
    if len(s) * 3 // 4 > MAX_DECODED_BYTES + 3:
        raise TooLarge("image is over 4 MB decoded")
    try:
        raw = base64.b64decode(s, validate=False)
    except (binascii.Error, ValueError) as e:
        raise BadImage(f"image_b64 is not base64: {e}") from None
    if len(raw) > MAX_DECODED_BYTES:
        raise TooLarge("image is over 4 MB decoded")
    return raw


def decode(s: str, max_side: int = MAX_SIDE) -> np.ndarray:
    """base64 JPEG/PNG/WebP -> BGR uint8, transparent pixels composited onto white, long side <= max_side."""
    img = cv2.imdecode(np.frombuffer(b64_bytes(s), np.uint8), cv2.IMREAD_UNCHANGED)
    if img is None or img.size == 0:
        raise BadImage("could not decode image (expected JPEG, PNG or WebP)")
    if img.dtype != np.uint8:
        img = cv2.convertScaleAbs(img, alpha=255.0 / max(1, int(img.max())))
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        a = img[:, :, 3:4].astype(np.float32) / 255.0
        img = (img[:, :, :3].astype(np.float32) * a + 255.0 * (1 - a)).astype(np.uint8)
    h, w = img.shape[:2]
    if min(h, w) < 16:
        raise BadImage("image is too small")
    s_ = max_side / max(h, w)
    if s_ < 1:
        img = cv2.resize(img, (round(w * s_), round(h * s_)), interpolation=cv2.INTER_AREA)
    return np.ascontiguousarray(img)


def encode_jpeg_b64(bgr: np.ndarray, max_side: int = 384, quality: int = 85) -> str:
    h, w = bgr.shape[:2]
    s = max_side / max(h, w)
    if s < 1:
        bgr = cv2.resize(bgr, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    assert ok
    return base64.b64encode(buf.tobytes()).decode()
