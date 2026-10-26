"""Flatten the catalog editorial PNGs onto white and write JPEG fixtures.

The catalog PNGs are RGBA with a fully transparent background. Decoders that
drop alpha turn that background black, so both pipelines get the same white
JPEG bytes instead.

Run: uv run --with pillow python scripts/eval-prepare.py
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "costumes"
DST = ROOT / "eval" / "fixtures" / "editorial"

DST.mkdir(parents=True, exist_ok=True)
for png in sorted(SRC.glob("*.png")):
    image = Image.open(png).convert("RGBA")
    white = Image.new("RGBA", image.size, (255, 255, 255, 255))
    flat = Image.alpha_composite(white, image).convert("RGB")
    flat.save(DST / f"{png.stem}.jpg", quality=90)
    print(png.stem)
