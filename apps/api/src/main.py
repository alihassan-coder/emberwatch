"""EmberWatch API.

Run locally (from apps/api):
    uv run alembic upgrade head        # create or update the database
    uv run python -m src.seed          # optional: load the real demo day
    uv run fastapi dev src/main.py     # http://localhost:8000/docs
"""

from __future__ import annotations

import io
from contextlib import asynccontextmanager

import numpy as np
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from src import model_registry
from src.config import load_settings
from src.db import get_engine, get_session, new_session
from src.db.models import ModelVersion
from src.routers import alerts, cameras, notifications
from src.schemas import FrameScore, Health, TileScore
from src.smoke_model import SmokeModel

MAX_UPLOAD_BYTES = 15 * 1024 * 1024


def schema_version() -> str | None:
    """The Alembic revision the database is at, or None if it was never migrated."""
    engine = get_engine()
    if not inspect(engine).has_table("alembic_version"):
        return None
    with engine.connect() as conn:
        return conn.execute(text("SELECT version_num FROM alembic_version")).scalar()


def register_model(stored: model_registry.StoredModel) -> int:
    """Record the served model version in the database (once) and return its id."""
    with new_session() as session:
        row = session.scalar(
            select(ModelVersion).where(ModelVersion.name == stored.spec["name"], ModelVersion.version == stored.version)
        )
        if row is None:
            row = ModelVersion(
                name=stored.spec["name"], version=stored.version, sha256=stored.sha256, threshold=float(stored.spec["threshold"])
            )
            session.add(row)
            session.commit()
        return row.id


@asynccontextmanager
async def lifespan(app: FastAPI):
    if schema_version() is None:
        raise RuntimeError("The database has no schema yet. Run: uv run alembic upgrade head")
    stored = model_registry.load(model_registry.active_version())  # refuses a damaged model file
    app.state.model = SmokeModel(stored.path, load_settings().onnx_threads, version=stored.version)
    app.state.model_version_id = register_model(stored)
    yield


app = FastAPI(
    title="EmberWatch API",
    description="Wildfire smoke detection on tower-camera photos: scoring, alerts, reviews and notifications.",
    version="0.2.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=load_settings().cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.include_router(cameras.router)
app.include_router(alerts.router)
app.include_router(notifications.router)


@app.get("/health", response_model=Health, tags=["system"])
def health(request: Request) -> Health:
    model: SmokeModel = request.app.state.model
    return Health(
        status="ok",
        model_name=model.name,
        model_version=model.version,
        threshold=model.threshold,
        database=get_engine().dialect.name,
        schema_version=schema_version(),
    )


class ModelVersionOut(BaseModel):
    version: str
    name: str
    threshold: float
    sha256: str | None
    active: bool


@app.get("/v1/models", response_model=list[ModelVersionOut], tags=["system"])
def list_models(request: Request) -> list[ModelVersionOut]:
    """Model versions in the local store, and which one is being served."""
    serving = request.app.state.model.version
    return [
        ModelVersionOut(
            version=m.version,
            name=m.spec["name"],
            threshold=float(m.spec["threshold"]),
            sha256=m.sha256,
            active=m.version == serving,
        )
        for m in model_registry.list_versions()
    ]


@app.post("/v1/frames/score", response_model=FrameScore, tags=["detection"])
async def score_frame(request: Request, image: UploadFile = File(description="A JPEG or PNG camera frame")) -> FrameScore:
    """Score any photo for smoke without storing it (the 'Check a photo' page)."""
    raw = await image.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image larger than 15 MB")
    try:
        with Image.open(io.BytesIO(raw)) as img:
            frame = np.asarray(img.convert("RGB"))
    except UnidentifiedImageError as err:
        raise HTTPException(status_code=415, detail="Not a readable image (send JPEG or PNG)") from err
    model: SmokeModel = request.app.state.model
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
        whole_photo=result.whole,
    )


@app.get("/v1/db/ping", include_in_schema=False)
def db_ping(session: Session = Depends(get_session)) -> dict:
    session.execute(text("SELECT 1"))
    return {"ok": True}
