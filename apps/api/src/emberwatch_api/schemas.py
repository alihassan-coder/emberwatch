"""Request/response shapes. They also generate the OpenAPI docs (/docs) and
the TypeScript types the web app uses."""

from __future__ import annotations

from pydantic import BaseModel, Field


class Health(BaseModel):
    status: str = Field(examples=["ok"])
    model_name: str
    model_version: str
    threshold: float


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
