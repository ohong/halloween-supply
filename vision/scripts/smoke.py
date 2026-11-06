"""E2E smoke test against a running vision service (no mocks).

    VISION_SERVICE_TOKEN=dev-token uv run python scripts/smoke.py [--url http://localhost:8080]

For each costume it calls /v1/analyze on the worn model photo, checks the response against the
contract, writes an overlay to debug/<costume>.png, then calls /v1/match with the catalog
product shot (expected: match) and another costume's shot (expected: not a better match).
"""

import argparse
import base64
import json
import os
import sys
import urllib.request
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
COSTUMES = ["cosmic-cowboy", "linen-ghost", "midnight-pirate"]
# A bedsheet ghost is one sheet plus shoes: the segmenter has nothing else to find.
MIN_PIECES = {"linen-ghost": 2}
SLOTS = {"head", "top", "outer", "bottom", "feet", "accessory"}
DEBUG = Path(__file__).resolve().parents[1] / "debug"


def call(url, path, body=None, token=None):
    req = urllib.request.Request(url + path, data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, dict(r.headers), json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), json.loads(e.read())


def b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


def photo(costume: str) -> Path:
    for name in (f"{costume}-female.webp", f"{costume}-male.webp"):
        p = ROOT / "public/costumes/models" / name
        if p.exists():
            return p
    return ROOT / "public/costumes" / f"{costume}.png"


def overlay(img_path: Path, res: dict, out: Path):
    img = cv2.imdecode(np.frombuffer(img_path.read_bytes(), np.uint8), cv2.IMREAD_UNCHANGED)
    if img.shape[2] == 4:  # composite onto white, as the service does
        a = img[:, :, 3:4].astype(np.float32) / 255.0
        img = (img[:, :, :3] * a + 255.0 * (1 - a)).astype(np.uint8)
    s = min(1.0, 1024 / max(img.shape[:2]))
    img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s < 1 else img
    panel = np.full((img.shape[0], 520, 3), 255, np.uint8)
    rng = np.random.default_rng(3)
    if res["person"]["found"]:
        x, y, w, h = res["person"]["bbox"]
        cv2.rectangle(img, (x, y), (x + w, y + h), (255, 255, 255), 2)
    yy = 30
    cv2.putText(panel, f"{res['title']}  person conf {res['person']['confidence']}", (10, yy),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    for p in res["pieces"]:
        col = tuple(int(c) for c in rng.integers(40, 230, 3))
        x, y, w, h = p["bbox"]
        cv2.rectangle(img, (x, y), (x + w, y + h), col, 1)
        cv2.polylines(img, [np.asarray(poly, np.int32) for poly in p["outline"]], True, col, 3)
        cv2.putText(img, p["id"], (x + 4, y + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, col, 2)
        yy += 34
        cv2.putText(panel, f"{p['id']} {p['region']}/{p['slot']} {p['pattern']}", (10, yy),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, col, 2)
        for j, c in enumerate(p["colors"]):
            r, g, b = (int(c["hex"][k:k + 2], 16) for k in (1, 3, 5))
            cv2.rectangle(panel, (330 + j * 60, yy - 14), (380 + j * 60, yy + 2), (b, g, r), -1)
        yy += 20
        cv2.putText(panel, f"  {p['query']}  ({p['garment_types'][0]['score']:.2f})", (10, yy),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (40, 40, 40), 1)
    cv2.imwrite(str(out), np.hstack([img, panel]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("VISION_SERVICE_URL", "http://localhost:8080"))
    args = ap.parse_args()
    token = os.environ["VISION_SERVICE_TOKEN"]
    DEBUG.mkdir(exist_ok=True)
    fails = []

    def check(ok, msg):
        print(("  ok   " if ok else "  FAIL ") + msg)
        if not ok:
            fails.append(msg)

    st, hdr, h = call(args.url, "/healthz")
    check(st == 200 and h["ok"] and "x-opencv-build" in {k.lower() for k in hdr}, f"healthz {h}")
    st, _, e = call(args.url, "/v1/analyze", {"image_b64": "x"}, token="wrong")
    check(st == 401 and e["error"]["code"] == "unauthorized", "401 on bad token")
    st, _, e = call(args.url, "/v1/analyze", {"image_b64": base64.b64encode(b"not an image").decode()}, token)
    check(st == 400 and e["error"]["code"] == "bad_image", "400 bad_image on garbage")

    analyzed = {}
    for costume in COSTUMES:
        p = photo(costume)
        print(f"{costume} ({p.name})")
        st, _, r = call(args.url, "/v1/analyze", {"image_b64": b64(p), "max_pieces": 8}, token)
        check(st == 200, f"analyze status {st}")
        if st != 200:
            continue
        analyzed[costume] = r
        overlay(p, r, DEBUG / f"{costume}.png")
        check(r["person"]["found"] and r["person"]["confidence"] >= 0.5, f"person {r['person']}")
        check(len(r["pieces"]) >= MIN_PIECES.get(costume, 3), f"{len(r['pieces'])} pieces: {[x['query'] for x in r['pieces']]}")
        W, H = r["image"]["width"], r["image"]["height"]
        for x in r["pieces"]:
            pts = np.asarray([pt for poly in x["outline"] for pt in poly]).reshape(-1, 2)
            check(len(pts) >= 3 and pts[:, 0].min() >= 0 and pts[:, 0].max() < W and pts[:, 1].min() >= 0
                  and pts[:, 1].max() < H, f"{x['id']} outline: {len(x['outline'])} polys, {len(pts)} points")
            e = np.asarray(x["embedding"])
            check(x["slot"] in SLOTS and len(x["garment_types"]) == 3 and e.shape == (512,)
                  and abs(np.linalg.norm(e) - 1) < 1e-3 and x["colors"], f"{x['id']} shape ok ({x['region']})")
        check(r["title"].endswith(" look"), f"title {r['title']!r}  timings {r['timings_ms']}")

    for costume, r in analyzed.items():
        piece = max(r["pieces"], key=lambda x: x["area_frac"])
        other = next(c for c in COSTUMES if c != costume)
        cands = [{"id": costume, "image_b64": b64(ROOT / "public/costumes" / f"{costume}.png")},
                 {"id": other, "image_b64": b64(ROOT / "public/costumes" / f"{other}.png")}]
        body = {"piece": {"region": piece["region"], "colors": piece["colors"], "embedding": piece["embedding"],
                          "garment_phrase": piece["garment_types"][0]["phrase"]}, "candidates": cands}
        st, _, m = call(args.url, "/v1/match", body, token)
        check(st == 200, f"match status {st}")
        if st != 200:
            continue
        own, rival = m["results"]
        print(f"  {costume} {piece['region']}: own {own['score']} {own['verdict']} {own['reasons']} | "
              f"{other} {rival['score']} {rival['verdict']} {rival['reasons']}  {m['timings_ms']}")
        check(own["garment_found"] and own["score"] > rival["score"], "own product shot outscores the other costume")

    print(f"\n{'PASS' if not fails else f'FAIL ({len(fails)})'}; overlays in {DEBUG}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
