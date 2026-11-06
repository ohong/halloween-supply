"""Download the runtime model weights into models/ and verify their SHA-256 hashes.

    uv run python scripts/fetch_models.py [--all]

--all also fetches the CLIP text model and tokenizer, which only scripts/embed_vocabulary.py needs.
Stdlib only, so the Docker build can run it before any dependency is installed.
"""

import hashlib
import sys
import urllib.request
from pathlib import Path

MODELS = Path(__file__).resolve().parents[1] / "models"
SEGFORMER = "https://huggingface.co/mattmdjaga/segformer_b2_clothes/resolve/584abc1e1d260e23c0fc627c5217a09b2b461046"
CLIP = "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/d15189d7028b43f1d3e65039190477f6af591c2a"

# name -> (url, sha256, needed at runtime)
FILES = {
    "segformer_b2_clothes.onnx": (f"{SEGFORMER}/onnx/model.onnx",
                                  "a93a8dac171b5c1fcc53632a8bfc180bfd9759ea69a3e207451bb07f76add54f", True),
    "clip_vit_b32_vision.onnx": (f"{CLIP}/onnx/vision_model.onnx",
                                 "fd6e1402a588279d1723c7534d4bcba5bc0b14b47dfab0e46f8c47b8270d7d40", True),
    "clip_vit_b32_text.onnx": (f"{CLIP}/onnx/text_model.onnx",
                               "3f6571f5bad13a97c469c1622e1cfc4d9aef78b79fdbfcff804ca357bfada8cc", False),
    "clip_tokenizer.json": (f"{CLIP}/tokenizer.json",
                            "f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd", False),
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    MODELS.mkdir(exist_ok=True)
    want_all = "--all" in sys.argv
    for name, (url, digest, runtime) in FILES.items():
        if not (runtime or want_all):
            continue
        dest = MODELS / name
        if dest.exists() and sha256(dest) == digest:
            print(f"ok      {name}")
            continue
        print(f"fetch   {name}")
        tmp = dest.with_suffix(dest.suffix + ".part")
        urllib.request.urlretrieve(url, tmp)
        got = sha256(tmp)
        if got != digest:
            tmp.unlink()
            sys.exit(f"sha256 mismatch for {name}: expected {digest}, got {got}")
        tmp.rename(dest)
        print(f"ok      {name}")


if __name__ == "__main__":
    main()
