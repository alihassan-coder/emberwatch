"""The notification outbox: what was sent (or simulated) about each alert."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.db import get_session
from src.db.models import Alert, Notification
from src.schemas import NotificationOut

router = APIRouter(prefix="/v1/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    alert: str | None = Query(default=None, description="Only notifications about this alert code"),
    limit: int = Query(default=50, le=500),
    session: Session = Depends(get_session),
) -> list[NotificationOut]:
    query = select(Notification).options(selectinload(Notification.alert)).order_by(Notification.created_at.desc()).limit(limit)
    if alert:
        query = query.join(Alert).where(Alert.code == alert)
    return [
        NotificationOut(id=n.id, alert=n.alert.code, channel=n.channel.value, target=n.target, status=n.status.value,
                        created_at=n.created_at, sent_at=n.sent_at, error=n.error)
        for n in session.scalars(query)
    ]
