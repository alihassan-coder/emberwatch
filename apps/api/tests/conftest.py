"""Shared test setup.

Every test gets its own SQLite file, created by the real Alembic migrations
(so the migrations are exercised on every run). The API tests swap in a tiny
fake model, so they don't need the 16 MB ONNX file.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

from src import config as config_module
from src.db import session as session_module

API_ROOT = Path(__file__).resolve().parents[1]
T0 = datetime(2026, 1, 8, 12, 0, tzinfo=timezone.utc)


def _clear_caches() -> None:
    config_module.load_settings.cache_clear()
    session_module.get_engine.cache_clear()
    session_module._session_factory.cache_clear()


def alembic_config() -> Config:
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "migrations"))
    return cfg


@pytest.fixture
def db_url(tmp_path, monkeypatch) -> str:
    url = f"sqlite:///{tmp_path / 'test.db'}"
    monkeypatch.setenv("EMBERWATCH_DATABASE_URL", url)
    monkeypatch.setenv("EMBERWATCH_ALERT_WEBHOOK_URL", "")
    _clear_caches()
    yield url
    session_module.get_engine().dispose()
    _clear_caches()


@pytest.fixture
def migrated(db_url) -> str:
    command.upgrade(alembic_config(), "head")
    return db_url


@pytest.fixture
def session(migrated):
    s = session_module.new_session()
    yield s
    s.close()


@pytest.fixture
def world(session):
    """Two sites 20 km apart (same latitude) and three cameras, plus a model version.

    'west-60' (facing 60 deg) and 'east-300' (facing 300 deg) cross about 6 km
    north of the midpoint, at a 120 deg angle: one plume, locatable.
    'east-120' faces south-east: its line only meets west-60's behind it,
    so it is never the same plume as west-60.
    """
    from src.db.models import Camera, ModelVersion, Site

    west = Site(key="west", name="West tower", lat=43.70, lon=7.00)
    east = Site(key="east", name="East tower", lat=43.70, lon=7.2483)
    cams = {
        "west-60": Camera(key="west-60", site=west, heading=60, fov=87),
        "east-300": Camera(key="east-300", site=east, heading=300, fov=87),
        "east-120": Camera(key="east-120", site=east, heading=120, fov=87),
    }
    version = ModelVersion(name="test-model", version="t-1", sha256=None, threshold=0.5)
    session.add_all([west, east, version, *cams.values()])
    session.commit()
    return {"cams": cams, "version": version}


def centred_tiles(width: int = 960) -> list[dict]:
    """Tile scores whose strongest tile is the centre column: bearing = camera heading."""
    size = width // 3
    return [{"x": i * size, "y": 0, "size": size, "p": 0.99 if i == 1 else 0.01} for i in range(3)]


@pytest.fixture
def add_frame(session, world):
    """add_frame('west-60', minute=0, score=0.9) -> (frame, alert or None), run through the real alert rule."""
    from src.db.models import Frame
    from src.services.alerts import process_frame

    def _add(camera_key: str, minute: float, score: float):
        camera = world["cams"][camera_key]
        frame = Frame(camera=camera, taken_at=T0 + timedelta(minutes=minute), score=score,
                      tiles=centred_tiles(), model_version=world["version"])
        session.add(frame)
        session.flush()
        alert = process_frame(session, camera, frame)
        session.commit()
        return frame, alert

    return _add


# ── API: a fake model so tests don't need the real ONNX file ───────────────

class FakeModel:
    """Stands in for SmokeModel: returns the next queued score for each photo."""

    name = "fake-model"
    version = "fake-1"
    threshold = 0.5

    def __init__(self):
        self.scores: list[float] = []

    def score(self, pixels):
        from src.smoke_model import FrameResult, Tile

        p = self.scores.pop(0) if self.scores else 0.05
        h, w = pixels.shape[:2]
        size = max(1, w // 3)
        tiles = [Tile(y=0, x=i * size, size=size, probability=p if i == 1 else 0.01) for i in range(3)]
        return FrameResult(score=p, smoke=p >= self.threshold, threshold=self.threshold, tiles=tiles,
                           width=w, height=h, latency_ms=1.0)


@pytest.fixture
def fake_model():
    return FakeModel()


@pytest.fixture
def client(world, fake_model, monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    from src import main
    from src.model_registry import StoredModel

    monkeypatch.setattr(main.model_registry, "active_version", lambda: "fake-1")
    monkeypatch.setattr(main.model_registry, "load", lambda version, verify=True: StoredModel(
        version="fake-1", path=tmp_path, spec={"name": "fake-model", "threshold": 0.5}, sha256=None))
    monkeypatch.setattr(main.model_registry, "list_versions", lambda: [StoredModel(
        version="fake-1", path=tmp_path, spec={"name": "fake-model", "threshold": 0.5}, sha256=None)])
    monkeypatch.setattr(main, "SmokeModel", lambda *a, **k: fake_model)
    monkeypatch.setattr("src.routers.cameras.FRAMES_DIR", tmp_path / "frames")
    with TestClient(main.app) as c:
        yield c


@pytest.fixture
def jpeg_bytes() -> bytes:
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (960, 540), (120, 140, 160)).save(buf, "JPEG")
    return buf.getvalue()
