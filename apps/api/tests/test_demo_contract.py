"""Contract: the browser replay and the backend raise the same alerts on the demo day.

apps/web runs its own copy of the alert rules in the browser (so the demo
works without this API). Both sides are pinned to one shared file,
apps/web/src/data/demo/expected_alerts.json; the web test suite checks the
browser engine against it, and this test checks the backend.
"""

import json
from zoneinfo import ZoneInfo

from src.config import API_ROOT
from src.db.models import ModelVersion
from src.seed import LOCAL_TIME, MANIFEST, load_demo

EXPECTED = API_ROOT.parent / "web" / "src" / "data" / "demo" / "expected_alerts.json"
WEB_MANIFEST = API_ROOT.parent / "web" / "src" / "data" / "demo" / "manifest.json"


def as_contract(alerts) -> list[dict]:
    return [
        {
            "code": a.code,
            "cameras": [link.camera.key for link in a.cameras],
            "bearings": [round(link.bearing, 1) for link in a.cameras],
            "raised_at": a.raised_at.replace(tzinfo=ZoneInfo("UTC")).astimezone(LOCAL_TIME).strftime("%Y-%m-%dT%H-%M-%S"),
            "location": None if a.lat is None else [round(a.lat, 3), round(a.lon, 3)],
            "peak_score": round(a.peak_score, 4),
        }
        for a in alerts
    ]


def run_demo(session) -> list[dict]:
    version = ModelVersion(name="m", version="test", threshold=0.23)
    session.add(version)
    return as_contract(load_demo(session, json.loads(MANIFEST.read_text()), version))


def test_backend_and_web_replay_use_the_same_demo_day():
    assert json.loads(MANIFEST.read_text()) == json.loads(WEB_MANIFEST.read_text())


def test_backend_raises_the_expected_demo_alerts(session):
    assert run_demo(session) == json.loads(EXPECTED.read_text())
