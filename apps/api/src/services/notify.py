"""Notifications through an outbox.

Each message is first written to the notifications table (so nothing is lost
if sending fails), then delivered:
  - webhook: really POSTed as JSON when EMBERWATCH_ALERT_WEBHOOK_URL is set
  - sms / email: no provider is configured yet, so they are marked
    "simulated" (recorded, not sent)
"""

from __future__ import annotations

import httpx
from sqlalchemy.orm import Session

from src.config import load_settings
from src.db.base import utcnow
from src.db.models import Alert, Channel, DeliveryStatus, Notification


def _payload(alert: Alert, event: str) -> dict:
    return {
        "event": event,
        "alert": alert.code,
        "status": alert.status.value,
        "peak_score": round(alert.peak_score, 3),
        "cameras": [link.camera.key for link in alert.cameras],
        "location": {"lat": alert.lat, "lon": alert.lon} if alert.lat is not None else None,
        "raised_at": alert.raised_at.isoformat(),
    }


def _deliver(n: Notification) -> None:
    url = load_settings().alert_webhook_url
    if n.channel is Channel.WEBHOOK and url:
        try:
            httpx.post(url, json=n.payload, timeout=5).raise_for_status()
            n.status, n.sent_at = DeliveryStatus.SENT, utcnow()
        except httpx.HTTPError as exc:
            n.status, n.error = DeliveryStatus.FAILED, str(exc)[:500]
    else:
        n.status, n.sent_at = DeliveryStatus.SIMULATED, utcnow()


def _queue(session: Session, alert: Alert, channel: Channel, target: str, event: str) -> None:
    n = Notification(alert=alert, channel=channel, target=target, payload=_payload(alert, event))
    session.add(n)
    _deliver(n)


def on_new_alert(session: Session, alert: Alert) -> None:
    """A new alert needs a person to look at it."""
    _queue(session, alert, Channel.SMS, "Duty officer", "alert.raised")


def on_confirmed(session: Session, alert: Alert) -> None:
    """An operator confirmed a fire: tell the people who respond."""
    _queue(session, alert, Channel.EMAIL, "Fire station", "alert.confirmed")
    _queue(session, alert, Channel.WEBHOOK, load_settings().alert_webhook_url or "Dispatch system", "alert.confirmed")
