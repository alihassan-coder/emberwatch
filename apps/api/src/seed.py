"""Load the real demo day into the database.

8 January 2024, Alpes-Maritimes: four tower sites, six cameras and 72 real
Pyro-SDIS frames already scored by the model (seed/demo_manifest.json, from
ml/src/data/demo_frames.py). Every frame goes through the same alert pipeline
as a live upload, so the alerts are produced by the backend's own rules.

Run (from apps/api, after `uv run alembic upgrade head`):
    uv run python -m src.seed            # load (skips if already loaded)
    uv run python -m src.seed --reset    # wipe alerts/frames/cameras first
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select

from src import model_registry
from src.config import API_ROOT
from src.db import new_session
from src.db.models import Alert, AlertCamera, Camera, Frame, ModelVersion, Notification, Review, Site
from src.services.alerts import process_frame

MANIFEST = API_ROOT / "seed" / "demo_manifest.json"
LOCAL_TIME = ZoneInfo("Europe/Paris")  # Pyro-SDIS timestamps are local camera time

# Approximate tower positions (from place names; exact sites aren't published).
SITES = {
    "ferion": ("Mont Férion", 43.787, 7.236),
    "courmettes": ("Pic de Courmettes", 43.744, 7.005),
    "valbonne": ("Valbonne", 43.641, 7.009),
    "cabanelle": ("Cabanelle", 43.832, 7.07),
}


def taken_at(stamp: str) -> datetime:
    return datetime.strptime(stamp, "%Y-%m-%dT%H-%M-%S").replace(tzinfo=LOCAL_TIME).astimezone(ZoneInfo("UTC"))


def reset(session) -> None:
    for model in (Notification, Review, AlertCamera, Alert, Frame, Camera, Site):
        session.execute(delete(model))
    session.commit()


def load_demo(session, manifest: dict, version: ModelVersion) -> list[Alert]:
    """Feed the demo day through the alert pipeline, as if live. Returns the alerts, oldest first.

    The web app's browser replay runs the same rules on the same manifest, and
    both are pinned to apps/web/src/data/demo/expected_alerts.json by tests.
    """
    sites = {key: Site(key=key, name=name, lat=lat, lon=lon, position_approximate=True)
             for key, (name, lat, lon) in SITES.items()}
    session.add_all(sites.values())
    cameras = {c["id"]: Camera(key=c["id"], site=sites[c["site"]], heading=c["heading"], fov=87.0)
               for c in manifest["cameras"]}
    session.add_all(cameras.values())
    session.flush()

    # Feed every frame in the order the cameras took them, as if live.
    frames = sorted(((c["id"], f) for c in manifest["cameras"] for f in c["frames"]), key=lambda x: x[1]["taken"])
    for cam_key, f in frames:
        frame = Frame(camera=cameras[cam_key], taken_at=taken_at(f["taken"]), score=f["score"], tiles=f["tiles"],
                      image_path=f"web:/demo/{f['file']}", model_version=version)
        session.add(frame)
        session.flush()
        process_frame(session, cameras[cam_key], frame)
    session.flush()
    return list(session.scalars(select(Alert).order_by(Alert.id)))


def main() -> None:
    ap = argparse.ArgumentParser(description="Load the real demo day")
    ap.add_argument("--reset", action="store_true", help="delete existing alerts, frames and cameras first")
    args = ap.parse_args()

    manifest = json.loads(MANIFEST.read_text())
    stored = model_registry.load(model_registry.active_version(), verify=False)

    with new_session() as session:
        if args.reset:
            reset(session)
        if session.scalar(select(func.count(Frame.id))):
            print("Demo data is already loaded. Use --reset to load it again.")
            return

        version = session.scalar(select(ModelVersion).where(ModelVersion.version == stored.version))
        if version is None:
            version = ModelVersion(name=stored.spec["name"], version=stored.version, sha256=stored.sha256,
                                   threshold=float(stored.spec["threshold"]))
            session.add(version)

        alerts = load_demo(session, manifest, version)
        session.commit()
        n_frames = sum(len(c["frames"]) for c in manifest["cameras"])
        print(f"Loaded {len(SITES)} sites, {len(manifest['cameras'])} cameras, {n_frames} frames, {len(alerts)} alerts.")
        for a in alerts:
            where = f"{a.lat:.3f}, {a.lon:.3f}" if a.lat is not None else "no location (one site)"
            print(f"  {a.code}: {', '.join(link.camera.key for link in a.cameras)} | peak {a.peak_score:.2f} | {where}")


if __name__ == "__main__":
    main()
