"""FastAPI app implementing plans/contract.md v1."""

import hmac
import json
import os
import platform
import sys
import time

import anyio.to_thread
import cv2
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import models
from .analyze import analyze
from .imageio import BadImage, TooLarge, decode
from .match import match

MAX_IMAGES = 12
TOKEN = os.environ.get("VISION_SERVICE_TOKEN", "")
if not TOKEN:
    sys.exit("VISION_SERVICE_TOKEN is not set")

CPUS = os.cpu_count() or 1
# Requests that can run at once. They share one copy of each net (see app/models.py).
WORKERS = int(os.environ.get("VISION_WORKERS", str(min(CPUS, 4))))
cv2.setNumThreads(CPUS)
BUILD = "cool" if os.environ.get("OPENCV_BUILD") == "cool" or "COOL" in cv2.getBuildInformation() else "stock"
BUILD_HEADER = f"{cv2.__version__};{BUILD}"
GIT_SHA = os.environ.get("GIT_SHA", "dev")

app = FastAPI(title="halloween.supply vision", docs_url=None, redoc_url=None, openapi_url=None)


@app.on_event("startup")
async def _startup():
    anyio.to_thread.current_default_thread_limiter().total_tokens = WORKERS


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


@app.middleware("http")
async def _frame(request: Request, call_next):
    t0 = time.perf_counter()
    request.state.log = {}
    if request.url.path != "/healthz":
        auth = request.headers.get("authorization", "")
        if not hmac.compare_digest(auth.encode(), f"Bearer {TOKEN}".encode()):
            resp = _error(401, "unauthorized", "missing or wrong bearer token")
            resp.headers["X-OpenCV-Build"] = BUILD_HEADER
            return resp
    try:
        resp = await call_next(request)
    except Exception as e:  # noqa: BLE001 - last line of defense; logged below
        request.state.log["exception"] = f"{type(e).__name__}: {e}"
        resp = _error(500, "internal", "internal error")
    resp.headers["X-OpenCV-Build"] = BUILD_HEADER
    # One JSON line per request. Never log images or embeddings.
    print(json.dumps({"route": request.url.path, "status": resp.status_code,
                      "ms": round((time.perf_counter() - t0) * 1000, 1), "build": BUILD, "git": GIT_SHA,
                      **request.state.log}), flush=True)
    return resp


@app.exception_handler(BadImage)
async def _bad_image(_, e):
    return _error(400, "bad_image", str(e))


@app.exception_handler(TooLarge)
async def _too_large(_, e):
    return _error(413, "too_large", str(e))


@app.exception_handler(RequestValidationError)
async def _invalid(_, e):
    first = e.errors()[0] if e.errors() else {}
    return _error(400, "bad_image", f"invalid request: {'.'.join(map(str, first.get('loc', [])))} {first.get('msg', '')}")


@app.get("/healthz")
def healthz():
    return {"ok": True, "opencv_version": cv2.__version__, "build": BUILD, "arch": platform.machine(),
            "models": {**models.FINGERPRINTS, "vocabulary": f"{len(models.VOCAB)} phrases"}}


class AnalyzeRequest(BaseModel):
    image_b64: str
    max_pieces: int = Field(8, ge=1, le=10)


def _ms(seconds: float) -> int:
    return round(seconds * 1000)


@app.post("/v1/analyze")
def analyze_route(body: AnalyzeRequest, request: Request):
    t0 = time.perf_counter()
    bgr = decode(body.image_b64)
    t_decode = time.perf_counter() - t0
    out = analyze(bgr, body.max_pieces)
    out.pop("labels")
    t = out.pop("timings")
    timings = {"decode": _ms(t_decode), **{k: _ms(v) for k, v in t.items()}, "total": _ms(time.perf_counter() - t0)}
    out["timings_ms"] = timings
    request.state.log.update(timings=timings, n_pieces=len(out["pieces"]), person=out["person"]["found"])
    return out


class Color(BaseModel):
    name: str = ""
    hex: str = ""
    lab: list[float] = Field(min_length=3, max_length=3)
    frac: float = 0.0


class Piece(BaseModel):
    region: str
    colors: list[Color] = []
    embedding: list[float] = Field(min_length=512, max_length=512)
    garment_phrase: str = ""


class Candidate(BaseModel):
    id: str
    image_b64: str


class MatchRequest(BaseModel):
    piece: Piece
    candidates: list[Candidate]


@app.post("/v1/match")
def match_route(body: MatchRequest, request: Request):
    t0 = time.perf_counter()
    if len(body.candidates) > MAX_IMAGES:
        raise TooLarge(f"at most {MAX_IMAGES} candidates per request")
    if body.piece.region not in models.REGION_LABELS:
        raise BadImage(f"unknown region {body.piece.region!r}")
    images = []
    for c in body.candidates:
        try:
            images.append((c.id, decode(c.image_b64)))
        except BadImage as e:
            raise BadImage(f"candidate {c.id}: {e}") from None
    results = match(body.piece.model_dump(), images)
    timings = {"total": _ms(time.perf_counter() - t0)}
    request.state.log.update(timings=timings, n_candidates=len(images))
    return {"results": results, "timings_ms": timings}
