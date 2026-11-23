"""Settings, read once from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]  # .../apps/api (this file is apps/api/src/config.py)


@dataclass(frozen=True)
class Settings:
    # Local model store: models/versions/<version>/{model.onnx, model_spec.json, model.onnx.sha256}
    # and models/active.txt naming the version to serve (see src/model_registry.py).
    models_dir: Path
    # Serve this version instead of the one in active.txt (optional).
    model_version: str
    # Threads ONNX Runtime may use per request (the dev laptop has 4 cores).
    onnx_threads: int
    # Origins allowed to call the API from a browser (the Next.js app).
    cors_origins: list[str]
    # Any SQLAlchemy URL. SQLite locally; for PostgreSQL later set e.g.
    # postgresql+psycopg://user:pass@host/emberwatch and run the migrations.
    database_url: str
    # Alert rule: an alert is raised when a camera's score passes the
    # threshold in K of its last N frames.
    alert_threshold: float
    alert_k: int
    alert_n: int
    # Where confirmed-fire notifications are POSTed as JSON. Empty: notifications
    # are recorded in the outbox and marked "simulated" instead of sent.
    alert_webhook_url: str


@lru_cache
def load_settings() -> Settings:
    default_db = f"sqlite:///{API_ROOT / 'data' / 'emberwatch.db'}"
    return Settings(
        models_dir=Path(os.environ.get("EMBERWATCH_MODELS_DIR", API_ROOT / "models")),
        model_version=os.environ.get("EMBERWATCH_MODEL_VERSION", ""),
        onnx_threads=int(os.environ.get("EMBERWATCH_ONNX_THREADS", "4")),
        cors_origins=os.environ.get("EMBERWATCH_CORS_ORIGINS", "http://localhost:3000").split(","),
        database_url=os.environ.get("EMBERWATCH_DATABASE_URL", default_db),
        alert_threshold=float(os.environ.get("EMBERWATCH_ALERT_THRESHOLD", "0.5")),
        alert_k=int(os.environ.get("EMBERWATCH_ALERT_K", "2")),
        alert_n=int(os.environ.get("EMBERWATCH_ALERT_N", "3")),
        alert_webhook_url=os.environ.get("EMBERWATCH_ALERT_WEBHOOK_URL", ""),
    )
