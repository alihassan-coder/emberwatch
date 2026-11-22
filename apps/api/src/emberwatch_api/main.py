"""EmberWatch API.

Run locally:
    EMBERWATCH_MODEL_DIR=path/to/model uv run emberwatch-api
Then open http://localhost:8000/docs for interactive API docs.
"""

from __future__ import annotations

import io
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError

from emberwatch_api.config import load_settings
from emberwatch_api.schemas import FrameScore, Health, TileScore
from emberwatch_api.smoke_model import SmokeModel

MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # a 3072x2048 camera JPEG is ~3 MB


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the model once at start-up, not per request.
    settings = load_settings()
    app.state.model = SmokeModel(settings.model_dir, settings.onnx_threads)
    yield


settings = load_settings()
app = FastAPI(
    title="EmberWatch API",
    description="Wildfire smoke detection on tower-camera frames.",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def get_model(request: Request) -> SmokeModel:
    return request.app.state.model


@app.get("/health", response_model=Health, tags=["system"])
def health(request: Request) -> Health:
    model = get_model(request)
    return Health(status="ok", model_name=model.name, model_version=model.version, threshold=model.threshold)


@app.post("/v1/frames/score", response_model=FrameScore, tags=["detection"])
async def score_frame(request: Request, image: UploadFile = File(description="A JPEG or PNG camera frame")) -> FrameScore:
    """Score one camera frame for smoke. Returns the frame score and every tile's probability."""
    raw = await image.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image larger than 15 MB")
    try:
        with Image.open(io.BytesIO(raw)) as img:
            frame = np.asarray(img.convert("RGB"))
    except UnidentifiedImageError:
        raise HTTPException(status_code=415, detail="Not a readable image (send JPEG or PNG)")

    model = get_model(request)
    # ONNX Runtime is CPU-bound and blocking: run it off the event loop.
    result = await run_in_threadpool(model.score, frame)
    return FrameScore(
        smoke=result.smoke,
        score=result.score,
        threshold=result.threshold,
        width=result.width,
        height=result.height,
        tiles=[TileScore(**t.__dict__) for t in result.tiles],
        model_name=model.name,
        model_version=model.version,
        latency_ms=result.latency_ms,
    )
