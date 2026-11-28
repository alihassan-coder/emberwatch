"""Alerts: list them, read one, and record an operator's decision."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.db import get_session
from src.db.models import Alert, AlertCamera, AlertStatus, Camera, Verdict
from src.schemas import AlertCameraOut, AlertOut, ReviewIn, ReviewOut
from src.services.reviews import ReviewError, review

router = APIRouter(prefix="/v1/alerts", tags=["alerts"])

_LOAD = (
    selectinload(Alert.cameras).selectinload(AlertCamera.camera).selectinload(Camera.site),
    selectinload(Alert.reviews),
)


def alert_out(alert: Alert) -> AlertOut:
    return AlertOut(
        code=alert.code,
        status=alert.status.value,
        raised_at=alert.raised_at,
        peak_score=alert.peak_score,
        location={"lat": alert.lat, "lon": alert.lon} if alert.lat is not None else None,
        cameras=[
            AlertCameraOut(camera=link.camera.key, site=link.camera.site.name, bearing=round(link.bearing, 1))
            for link in alert.cameras
        ],
        reviews=[ReviewOut.model_validate(r) for r in alert.reviews],
    )


def _get(session: Session, code: str) -> Alert:
    alert = session.scalar(select(Alert).where(Alert.code == code).options(*_LOAD))
    if alert is None:
        raise HTTPException(status_code=404, detail=f"No alert {code}")
    return alert


@router.get("", response_model=list[AlertOut])
def list_alerts(
    status: AlertStatus | None = Query(default=None, description="Only alerts with this status"),
    session: Session = Depends(get_session),
) -> list[AlertOut]:
    query = select(Alert).options(*_LOAD).order_by(Alert.raised_at.desc())
    if status:
        query = query.where(Alert.status == status)
    return [alert_out(a) for a in session.scalars(query)]


@router.get("/{code}", response_model=AlertOut)
def get_alert(code: str, session: Session = Depends(get_session)) -> AlertOut:
    return alert_out(_get(session, code))


@router.post("/{code}/review", response_model=AlertOut)
def review_alert(code: str, body: ReviewIn, session: Session = Depends(get_session)) -> AlertOut:
    """Confirm a fire, dismiss it with a reason, or undo the last decision ('reopened')."""
    alert = _get(session, code)
    try:
        review(session, alert, Verdict(body.verdict), body.reason, body.reviewer)
    except ReviewError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    session.flush()
    session.refresh(alert)
    return alert_out(_get(session, code))
