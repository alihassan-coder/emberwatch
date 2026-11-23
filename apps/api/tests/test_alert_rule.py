"""From scored frames to alerts: the 2-of-3 rule, the time window, plume grouping."""

import pytest
from sqlalchemy import select

from src.db.models import Alert, AlertStatus, Channel, Notification


def test_one_smoke_photo_is_not_enough(add_frame):
    _, alert = add_frame("west-60", minute=0, score=0.95)
    assert alert is None


def test_two_of_three_smoke_photos_raise_an_alert(add_frame, session):
    add_frame("west-60", 0, 0.95)
    add_frame("west-60", 1, 0.10)
    _, alert = add_frame("west-60", 2, 0.90)
    assert alert is not None
    assert alert.status is AlertStatus.NEEDS_REVIEW
    assert [l.camera.key for l in alert.cameras] == ["west-60"]
    assert alert.peak_score == pytest.approx(0.95)
    # A new alert tells the duty officer straight away.
    sent = session.scalars(select(Notification).where(Notification.alert_id == alert.id)).all()
    assert [(n.channel, n.target) for n in sent] == [(Channel.SMS, "Duty officer")]


def test_photos_far_apart_in_time_do_not_add_up(add_frame):
    add_frame("west-60", 0, 0.95)
    _, alert = add_frame("west-60", 20, 0.95)     # 20 min later: outside the 15 min window
    assert alert is None


def test_a_long_fire_stays_one_alert(add_frame, session):
    for minute in range(0, 70, 5):                 # smoke every 5 minutes for over an hour
        add_frame("west-60", minute, 0.9)
    assert session.scalar(select(Alert).where(Alert.code.is_not(None))) is not None
    assert len(session.scalars(select(Alert)).all()) == 1


def test_crossing_cameras_join_one_alert_with_a_location(add_frame):
    add_frame("west-60", 0, 0.9)
    _, first = add_frame("west-60", 1, 0.9)
    add_frame("east-300", 1, 0.9)
    _, joined = add_frame("east-300", 2, 0.9)
    assert joined.code == first.code
    assert {l.camera.key for l in joined.cameras} == {"west-60", "east-300"}
    assert joined.lat is not None and joined.lat > 43.70   # north of the two towers


def test_cameras_that_do_not_cross_get_separate_alerts(add_frame, session):
    add_frame("west-60", 0, 0.9)
    _, a = add_frame("west-60", 1, 0.9)
    add_frame("east-120", 1, 0.9)
    _, b = add_frame("east-120", 2, 0.9)
    assert a.code != b.code
    assert b.lat is None                                   # one tower only: no location
    assert len(session.scalars(select(Alert)).all()) == 2


def test_a_dismissed_alert_is_not_revived_by_a_clear_photo(add_frame, session):
    add_frame("west-60", 0, 0.9)
    _, alert = add_frame("west-60", 1, 0.9)
    alert.status = AlertStatus.DISMISSED
    session.commit()
    _, again = add_frame("west-60", 2, 0.05)       # still "2 of last 3", but this photo is clear
    assert again is None
    assert len(session.scalars(select(Alert)).all()) == 1
