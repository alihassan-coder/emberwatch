"""Operator decisions on alerts. History is append-only; undo adds a 'reopened' review."""

from __future__ import annotations

from sqlalchemy.orm import Session

from src.db.models import Alert, AlertStatus, Review, Verdict
from src.services import notify

_STATUS = {
    Verdict.CONFIRMED: AlertStatus.CONFIRMED,
    Verdict.DISMISSED: AlertStatus.DISMISSED,
    Verdict.REOPENED: AlertStatus.NEEDS_REVIEW,
}


class ReviewError(ValueError):
    """The decision doesn't fit the alert's current state (shown to the caller as 409)."""


def review(session: Session, alert: Alert, verdict: Verdict, reason: str | None, reviewer: str) -> Review:
    if verdict is Verdict.DISMISSED and not reason:
        raise ReviewError("Say why it isn't a fire (for example 'Low cloud'): the reason trains the next model.")
    if verdict is Verdict.REOPENED and alert.status is AlertStatus.NEEDS_REVIEW:
        raise ReviewError(f"{alert.code} already needs review; there is nothing to undo.")
    if verdict is not Verdict.REOPENED and alert.status is not AlertStatus.NEEDS_REVIEW:
        raise ReviewError(f"{alert.code} was already reviewed ({alert.status.value}). Undo that first.")

    entry = Review(alert=alert, verdict=verdict, reason=reason if verdict is Verdict.DISMISSED else None, reviewer=reviewer)
    session.add(entry)
    alert.status = _STATUS[verdict]
    if verdict is Verdict.CONFIRMED:
        notify.on_confirmed(session, alert)
    return entry
