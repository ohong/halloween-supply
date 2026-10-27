"""Embed vocabulary.json phrases with the CLIP ViT-B/32 text encoder (offline-only).

Not used at service runtime: it produces vision/vocabulary.npy, a float32 [N,512]
array of L2-normalized text embeddings in vocabulary order.

Run:
    cd vision && uv run --with onnxruntime --with tokenizers python scripts/embed_vocabulary.py
    # optional image/text alignment check (prints top-10 phrases for an image):
    ... python scripts/embed_vocabulary.py --check ../public/costumes/midnight-pirate.png
"""
import argparse
import json
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

ROOT = Path(__file__).resolve().parent.parent
REGIONS = {"hat", "upper_clothes", "dress", "skirt", "pants", "belt", "shoes", "bag", "scarf", "sunglasses"}
SLOTS = {"head", "top", "outer", "bottom", "feet", "accessory"}
SIZE_KINDS = {"apparel", "pants", "shoe", "hat", "one_size"}
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)


def validate(vocab: list[dict]) -> None:
    assert 200 <= len(vocab) <= 300, f"entry count {len(vocab)} outside 200-300"
    seen = set()
    for e in vocab:
        assert e["region"] in REGIONS, e
        assert e["slot"] in SLOTS, e
        assert e["size_kind"] in SIZE_KINDS, e
        assert e["phrase"] and e["alternate"], e
        assert e["assembly"] is None or isinstance(e["assembly"], str), e
        key = (e["phrase"], e["region"])
        assert key not in seen, f"duplicate {key}"
        seen.add(key)
    counts = Counter(e["region"] for e in vocab)
    for r in REGIONS:
        assert counts[r] >= 8, f"region {r} has {counts[r]} entries"
    print("validation ok:", len(vocab), dict(counts))


def embed_texts(vocab: list[dict]) -> np.ndarray:
    tok = Tokenizer.from_file(str(ROOT / "models/clip_tokenizer.json"))
    sess = ort.InferenceSession(str(ROOT / "models/clip_vit_b32_text.onnx"))
    rows = []
    for e in vocab:
        ids = tok.encode(f"a photo of a {e['phrase']}").ids[:77]
        assert ids[0] == 49406 and ids[-1] == 49407, "tokenizer must add SOT/EOT"
        out = sess.run(["text_embeds"], {"input_ids": np.array([ids], dtype=np.int64)})[0]
        rows.append(out[0])
    arr = np.stack(rows).astype(np.float32)
    return arr / np.linalg.norm(arr, axis=1, keepdims=True)


def embed_image(path: str) -> np.ndarray:
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img.ndim == 3 and img.shape[2] == 4:
        a = img[:, :, 3:4].astype(np.float32) / 255
        img = (img[:, :, :3] * a + 255 * (1 - a)).astype(np.uint8)
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    h, w = img.shape[:2]
    s = 224 / min(h, w)
    img = cv2.resize(img, (max(224, round(w * s)), max(224, round(h * s))), interpolation=cv2.INTER_CUBIC)
    h, w = img.shape[:2]
    y, x = (h - 224) // 2, (w - 224) // 2
    img = img[y : y + 224, x : x + 224].astype(np.float32) / 255
    x = ((img - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
    sess = ort.InferenceSession(str(ROOT / "models/clip_vit_b32_vision.onnx"))
    emb = sess.run(["image_embeds"], {"pixel_values": x})[0][0]
    return emb / np.linalg.norm(emb)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", metavar="IMAGE", help="print top-10 vocabulary phrases for this image")
    args = ap.parse_args()

    vocab = json.loads((ROOT / "vocabulary.json").read_text())
    validate(vocab)
    arr = embed_texts(vocab)
    assert arr.shape == (len(vocab), 512) and arr.dtype == np.float32
    assert np.allclose(np.linalg.norm(arr, axis=1), 1.0, atol=1e-4)
    np.save(ROOT / "vocabulary.npy", arr)
    print("saved vocabulary.npy", arr.shape)

    sims = arr @ arr.T
    for i in (0, len(vocab) // 2):
        print(f"nearest to '{vocab[i]['phrase']}' ({vocab[i]['region']}):")
        for j in np.argsort(-sims[i])[1:4]:
            print(f"  {sims[i, j]:.3f} {vocab[j]['phrase']} ({vocab[j]['region']})")

    if args.check:
        scores = arr @ embed_image(args.check)
        print(f"top-10 for {args.check}:")
        for j in np.argsort(-scores)[:10]:
            print(f"  {scores[j]:.3f} {vocab[j]['phrase']} ({vocab[j]['region']})")


if __name__ == "__main__":
    main()
