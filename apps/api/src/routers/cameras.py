"""Cameras, and the ingestion of their photos: score, store, run the alert rule."""

from __future__ import annotations

import io
from datetime import datetime

import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from PIL import Image, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from src.config import API_ROOT
from src.db import get_session
from src.db.models import Camera, Frame
from src.routers.alerts import alert_out
from src.schemas import CameraOut, FrameIngested, FrameOut
from src.services.alerts import process_frame

router = APIRouter(prefix="/v1/cameras", tags=["cameras"])

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
FRAMES_DIR = API_ROOT / "data" / "frames"


def _camera(session: Session, key: str) -> Camera:
    camera = session.scalar(select(Camera).where(Camera.key == key).options(selectinload(Camera.site)))
    if camera is None:
        raise HTTPException(status_code=404, detail=f"No camera {key}")
    return camera


@router.get("", response_model=list[CameraOut])
def list_cameras(session: Session = Depends(get_session)) -> list[Camera]:
    return list(session.scalars(select(Camera).options(selectinload(Camera.site)).order_by(Camera.key)))


@router.get("/{key}/frames", response_model=list[FrameOut])
def recent_frames(key: str, limit: int = Query(default=20, le=200), session: Session = Depends(get_session)) -> list[FrameOut]:
    camera = _camera(session, key)
    frames = session.scalars(
        select(Frame).where(Frame.camera_id == camera.id).options(selectinload(Frame.model_version))
        .order_by(Frame.taken_at.desc()).limit(limit)
    )
    return [FrameOut(id=f.id, taken_at=f.taken_at, score=f.score, model_version=f.model_version.version if f.model_version else None) for f in frames]


@router.post("/{key}/frames", response_model=FrameIngested, status_code=201)
async def ingest_frame(
    key: str,
    request: Request,
    image: UploadFile = File(description="The camera's JPEG/PNG photo"),
    taken_at: datetime = Form(description="When the camera took the photo (ISO 8601 with timezone)"),
    session: Session = Depends(get_session),
) -> FrameIngested:
    """Score a camera photo, store it, and run the alert rule for that camera."""
    if taken_at.tzinfo is None:
        raise HTTPException(status_code=422, detail="taken_at needs a timezone, e.g. 2024-01-08T12:43:00Z")
    camera = _camera(session, key)
    raw = await image.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image larger than 15 MB")
    try:
        with Image.open(io.BytesIO(raw)) as img:
            pixels = np.asarray(img.convert("RGB"))
    except UnidentifiedImageError:
        raise HTTPException(status_code=415, detail="Not a readable image (send JPEG or PNG)")

    model = request.app.state.model
    result = await run_in_threadpool(model.score, pixels)

    path = FRAMES_DIR / key / f"{taken_at:%Y%m%dT%H%M%S}.jpg"
    frame = Frame(
        camera=camera, taken_at=taken_at, score=result.score,
        tiles=[{"x": t.x, "y": t.y, "size": t.size, "p": round(t.probability, 4)} for t in result.tiles],
        # Relative to apps/api when stored there, absolute otherwise (e.g. a separate data disk).
        image_path=str(path.relative_to(API_ROOT) if path.is_relative_to(API_ROOT) else path),
        model_version_id=request.app.state.model_version_id,
    )
    session.add(frame)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail=f"{key} already has a photo taken at {taken_at.isoformat()}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)

    alert = process_frame(session, camera, frame)
    session.flush()
    return FrameIngested(
        frame=FrameOut(id=frame.id, taken_at=frame.taken_at, score=frame.score, model_version=model.version),
        alert=alert_out(alert) if alert else None,
    )
