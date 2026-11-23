"""Request/response shapes. They also generate the OpenAPI docs (/docs) and
the TypeScript types the web app uses."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Health(BaseModel):
    status: str = Field(examples=["ok"])
    model_name: str
    model_version: str
    threshold: float
    database: str = Field(description="Database engine in use, e.g. sqlite")
    schema_version: str | None = Field(description="Alembic revision the database is at")


class TileScore(BaseModel):
    y: int = Field(description="Top edge of the tile in pixels")
    x: int = Field(description="Left edge of the tile in pixels")
    size: int = Field(description="Tile width and height in pixels")
    probability: float = Field(ge=0, le=1, description="Chance this tile shows smoke")


class FrameScore(BaseModel):
    smoke: bool = Field(description="True when score >= threshold")
    score: float = Field(ge=0, le=1, description="Highest tile probability in the frame")
    threshold: float
    width: int
    height: int
    tiles: list[TileScore]
    model_name: str
    model_version: str
    latency_ms: float = Field(description="Model time for this frame on the server")


# ── Database-backed resources ──────────────────────────────────────────────

class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class SiteOut(ORM):
    key: str
    name: str
    lat: float
    lon: float
    position_approximate: bool


class CameraOut(ORM):
    key: str
    heading: float
    fov: float
    active: bool
    site: SiteOut


class FrameOut(ORM):
    id: int
    taken_at: datetime
    score: float
    model_version: str | None = None


class AlertCameraOut(BaseModel):
    camera: str
    site: str
    bearing: float


class ReviewOut(ORM):
    verdict: Literal["confirmed", "dismissed", "reopened"]
    reason: str | None
    reviewer: str
    created_at: datetime


class NotificationOut(ORM):
    id: int
    alert: str
    channel: Literal["sms", "email", "webhook"]
    target: str
    status: Literal["pending", "sent", "simulated", "failed"]
    created_at: datetime
    sent_at: datetime | None
    error: str | None


class AlertOut(BaseModel):
    code: str
    status: Literal["needs_review", "confirmed", "dismissed"]
    raised_at: datetime
    peak_score: float
    location: dict[str, float] | None = Field(description="{lat, lon} where bearings cross, when 2+ sites see it")
    cameras: list[AlertCameraOut]
    reviews: list[ReviewOut]


class FrameIngested(BaseModel):
    frame: FrameOut
    alert: AlertOut | None = Field(description="The alert this camera now belongs to, if the alert rule passed")


class ReviewIn(BaseModel):
    verdict: Literal["confirmed", "dismissed", "reopened"] = Field(description="'reopened' undoes the last decision")
    reason: str | None = Field(default=None, max_length=120, description="Required when dismissing, e.g. 'Low cloud'")
    reviewer: str = Field(default="operator", max_length=80)
