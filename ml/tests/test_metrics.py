"""Evaluation rules. A wrong metric silently makes every result wrong, so these are pinned down."""

import numpy as np
import pytest

from src.evaluate.metrics import best_f1_threshold, frame_scores, sequence_metrics


def test_frame_scores_count_the_confusion_matrix():
    r = frame_scores(np.array([1, 1, 0, 0]), np.array([0.9, 0.2, 0.8, 0.1]), threshold=0.5)
    assert (r.tp, r.fp, r.fn, r.tn) == (1, 1, 1, 1)
    assert r.precision == r.recall == r.f1 == 0.5


def test_best_threshold_separates_cleanly_separable_scores():
    best = best_f1_threshold(np.array([0, 0, 1, 1]), np.array([0.1, 0.3, 0.7, 0.9]))
    assert best.f1 == 1.0
    assert 0.3 < best.threshold <= 0.7


def seq(event, onset, alerts, duration=3600, camera="c1"):
    return {"fire_event": event, "camera": camera, "onset_s": onset, "alert_times_s": alerts, "duration_s": duration}


def test_time_to_detect_is_measured_from_onset():
    m = sequence_metrics([seq("f1", onset=600, alerts=[900])])
    assert m["ttd_mean_min"] == 5.0
    assert m["false_alarms"] == 0


def test_alerts_before_onset_and_on_fire_free_cameras_are_false_alarms():
    m = sequence_metrics([seq("f1", onset=600, alerts=[100, 700]), seq(None, None, [50, 60], duration=86400)])
    assert m["false_alarms"] == 3
    assert m["false_alarms_per_camera_day"] == pytest.approx(3 / (90000 / 86400))


def test_a_fire_seen_by_two_cameras_counts_once_at_its_earliest_alert():
    m = sequence_metrics([seq("f1", 600, [1800], camera="a"), seq("f1", 600, [900], camera="b")])
    assert m["fire_events"] == 1 and m["detected"] == 1
    assert m["ttd_mean_min"] == 5.0


def test_a_missed_fire_lowers_recall():
    m = sequence_metrics([seq("f1", 600, [900]), seq("f2", 600, [])])
    assert m["event_recall"] == 0.5
    assert m["detected_within_10_min"] == 0.5
