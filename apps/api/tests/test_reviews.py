"""Operator decisions: rules, notifications, and an undo that keeps history."""

import pytest
from sqlalchemy import select

from src.db.models import AlertStatus, Channel, Notification, Verdict
from src.services.reviews import ReviewError, review


@pytest.fixture
def alert(add_frame):
    add_frame("west-60", 0, 0.9)
    _, alert = add_frame("west-60", 1, 0.9)
    return alert


def test_dismissing_needs_a_reason(session, alert):
    with pytest.raises(ReviewError, match="Say why"):
        review(session, alert, Verdict.DISMISSED, None, "op")
    assert alert.status is AlertStatus.NEEDS_REVIEW


def test_dismissing_with_a_reason(session, alert):
    review(session, alert, Verdict.DISMISSED, "Low cloud", "op")
    session.commit()
    assert alert.status is AlertStatus.DISMISSED
    assert [(r.verdict, r.reason) for r in alert.reviews] == [(Verdict.DISMISSED, "Low cloud")]


def test_confirming_notifies_the_fire_station_and_dispatch(session, alert):
    review(session, alert, Verdict.CONFIRMED, None, "op")
    session.commit()
    assert alert.status is AlertStatus.CONFIRMED
    channels = {n.channel for n in session.scalars(select(Notification).where(Notification.alert_id == alert.id))}
    assert channels == {Channel.SMS, Channel.EMAIL, Channel.WEBHOOK}   # SMS was sent when it was raised


def test_cannot_decide_twice_without_undo(session, alert):
    review(session, alert, Verdict.CONFIRMED, None, "op")
    with pytest.raises(ReviewError, match="already reviewed"):
        review(session, alert, Verdict.DISMISSED, "Fog", "op")


def test_undo_reopens_and_keeps_history(session, alert):
    review(session, alert, Verdict.CONFIRMED, None, "op")
    review(session, alert, Verdict.REOPENED, None, "op")
    session.commit()
    assert alert.status is AlertStatus.NEEDS_REVIEW
    assert [r.verdict for r in alert.reviews] == [Verdict.CONFIRMED, Verdict.REOPENED]


def test_nothing_to_undo_on_a_fresh_alert(session, alert):
    with pytest.raises(ReviewError, match="nothing to undo"):
        review(session, alert, Verdict.REOPENED, None, "op")
