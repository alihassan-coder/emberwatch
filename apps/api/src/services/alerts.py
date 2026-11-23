"""From scored frames to plume alerts.

After every new frame:
  1. Alert rule: the camera is "alerting" when its score passed the threshold
     in K of its last N frames.
  2. Plume grouping: an alerting camera joins an open alert if it's on the
     same site as one of the alert's cameras, or its bearing crosses one of
     their bearings within MAX_PLUME_KM of both (and at a usable angle).
     Otherwise it starts a new alert.
  3. Location estimate: the best crossing (closest to 90 degrees) of bearings
     from two different sites.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.config import load_settings
from src.db.models import Alert, AlertCamera, AlertStatus, Camera, Frame
from src.services import notify
from src.services.geo import angle_between, cross_bearings, distance_km

MAX_PLUME_KM = 45
OPEN_WINDOW = timedelta(minutes=30)  # an alert stays open while a camera saw it this recently
RULE_WINDOW = timedelta(minutes=15)  # the K-of-N rule only counts photos this recent
MIN_CROSS_ANGLE, MAX_CROSS_ANGLE = 30, 150


def bearing_of(camera: Camera, frame: Frame) -> float:
    """Camera heading, shifted by where the strongest smoke tile sits across the frame."""
    tiles = frame.tiles or []
    if not tiles:
        return camera.heading % 360
    width = max(t["x"] + t["size"] for t in tiles)
    best = max(tiles, key=lambda t: t["p"])
    offset = ((best["x"] + best["size"] / 2) / width - 0.5) * camera.fov
    return (camera.heading + offset) % 360


def is_alerting(session: Session, camera: Camera, frame: Frame) -> bool:
    """K of the camera's last N photos (taken within RULE_WINDOW) passed the threshold."""
    s = load_settings()
    recent = session.scalars(
        select(Frame.score)
        .where(Frame.camera_id == camera.id, Frame.taken_at <= frame.taken_at, Frame.taken_at >= frame.taken_at - RULE_WINDOW)
        .order_by(Frame.taken_at.desc()).limit(s.alert_n)
    ).all()
    return sum(score >= s.alert_threshold for score in recent) >= s.alert_k


def _same_plume(a_cam: Camera, a_bearing: float, b_cam: Camera, b_bearing: float) -> bool:
    if a_cam.site_id == b_cam.site_id:
        return True
    angle = angle_between(a_bearing, b_bearing)
    if not MIN_CROSS_ANGLE <= angle <= MAX_CROSS_ANGLE:
        return False
    fix = cross_bearings(a_cam.site.lat, a_cam.site.lon, a_bearing, b_cam.site.lat, b_cam.site.lon, b_bearing)
    if fix is None:
        return False
    return (distance_km(a_cam.site.lat, a_cam.site.lon, *fix) <= MAX_PLUME_KM
            and distance_km(b_cam.site.lat, b_cam.site.lon, *fix) <= MAX_PLUME_KM)


def locate(alert: Alert) -> tuple[float, float] | None:
    best, quality = None, -1.0
    links = alert.cameras
    for i, a in enumerate(links):
        for b in links[i + 1:]:
            if a.camera.site_id == b.camera.site_id:
                continue
            angle = angle_between(a.bearing, b.bearing)
            if not MIN_CROSS_ANGLE <= angle <= MAX_CROSS_ANGLE:
                continue
            fix = cross_bearings(a.camera.site.lat, a.camera.site.lon, a.bearing,
                                 b.camera.site.lat, b.camera.site.lon, b.bearing)
            q = 90 - abs(angle - 90)
            if fix and q > quality:
                best, quality = fix, q
    return best


def _next_code(session: Session) -> str:
    last = session.scalar(select(Alert.id).order_by(Alert.id.desc()).limit(1)) or 0
    return f"A-{2611 + last}"


def process_frame(session: Session, camera: Camera, frame: Frame) -> Alert | None:
    """Run the alert rule after a new frame. Returns the alert the camera belongs to, if any."""
    if not is_alerting(session, camera, frame):
        return None

    bearing = bearing_of(camera, frame)
    open_alerts = session.scalars(
        select(Alert).where(Alert.status != AlertStatus.DISMISSED, Alert.last_seen_at >= frame.taken_at - OPEN_WINDOW)
        .order_by(Alert.last_seen_at.desc())
    ).all()

    for alert in open_alerts:
        links = {link.camera_id: link for link in alert.cameras}
        if camera.id in links:                      # already part of this alert: keep it up to date
            alert.peak_score = max(alert.peak_score, frame.score)
            alert.last_seen_at = max(alert.last_seen_at, frame.taken_at)
            return alert
        if any(_same_plume(camera, bearing, link.camera, link.bearing) for link in alert.cameras):
            alert.cameras.append(AlertCamera(camera=camera, bearing=bearing, first_frame_id=frame.id))
            alert.peak_score = max(alert.peak_score, frame.score)
            alert.last_seen_at = max(alert.last_seen_at, frame.taken_at)
            alert.lat, alert.lon = locate(alert) or (alert.lat, alert.lon)
            return alert

    # A new alert only starts on a photo that itself shows smoke.
    if frame.score < load_settings().alert_threshold:
        return None

    alert = Alert(code=_next_code(session), status=AlertStatus.NEEDS_REVIEW, raised_at=frame.taken_at,
                  last_seen_at=frame.taken_at, peak_score=frame.score)
    alert.cameras.append(AlertCamera(camera=camera, bearing=bearing, first_frame_id=frame.id))
    session.add(alert)
    session.flush()
    notify.on_new_alert(session, alert)
    return alert
