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

        sites = {key: Site(key=key, name=name, lat=lat, lon=lon, position_approximate=True)
                 for key, (name, lat, lon) in SITES.items()}
        session.add_all(sites.values())
        cameras = {c["id"]: Camera(key=c["id"], site=sites[c["site"]], heading=c["heading"], fov=87.0)
                   for c in manifest["cameras"]}
        session.add_all(cameras.values())
        session.flush()

        # Feed every frame in the order the cameras took them, as if live.
        frames = sorted(((c["id"], f) for c in manifest["cameras"] for f in c["frames"]), key=lambda x: x[1]["taken"])
        raised = set()
        for cam_key, f in frames:
            frame = Frame(camera=cameras[cam_key], taken_at=taken_at(f["taken"]), score=f["score"], tiles=f["tiles"],
                          image_path=f"web:/demo/{f['file']}", model_version=version)
            session.add(frame)
            session.flush()
            alert = process_frame(session, cameras[cam_key], frame)
            if alert and alert.code not in raised:
                raised.add(alert.code)
                print(f"  {frame.taken_at:%Y-%m-%d %H:%M} UTC  {cam_key:15} -> {alert.code}")
        session.commit()

        print(f"Loaded {len(sites)} sites, {len(cameras)} cameras, {len(frames)} frames, {len(raised)} alerts.")
        for a in session.scalars(select(Alert).order_by(Alert.raised_at)):
            where = f"{a.lat:.3f}, {a.lon:.3f}" if a.lat is not None else "no location (one site)"
            print(f"  {a.code}: {', '.join(link.camera.key for link in a.cameras)} | peak {a.peak_score:.2f} | {where}")


if __name__ == "__main__":
    main()
