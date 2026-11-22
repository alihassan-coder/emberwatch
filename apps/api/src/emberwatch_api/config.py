"""Settings, read once from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    # Folder holding model.onnx + model_spec.json, exactly as the ML job exports them.
    model_dir: Path
    # Threads ONNX Runtime may use per request (the dev laptop has 4 cores).
    onnx_threads: int
    # Origins allowed to call the API from a browser (the Next.js app).
    cors_origins: list[str]


def load_settings() -> Settings:
    return Settings(
        model_dir=Path(os.environ.get("EMBERWATCH_MODEL_DIR", "models/current")),
        onnx_threads=int(os.environ.get("EMBERWATCH_ONNX_THREADS", "4")),
        cors_origins=os.environ.get("EMBERWATCH_CORS_ORIGINS", "http://localhost:3000").split(","),
    )
