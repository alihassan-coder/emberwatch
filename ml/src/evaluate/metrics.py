"""Evaluation metrics shared by every EmberWatch model (pure numpy).

Three levels, matching the targets in docs/research/02-prior-work-and-metrics.md:

  Box level      AP@0.5 for smoke boxes in frames (detector quality)
  Frame level    precision / recall / F1 for "does this frame contain smoke?"
                 (target F1 >= 0.82; SmokeyNet 82.6)
  Sequence level time to detect from onset, share of fire events detected
                 within 10 min, and false alarms per camera-day
                 (targets: mean <= 3 min, >= 90% within 10 min, <= 0.5 / camera-day)

Boxes are [ymin, xmin, ymax, xmax] in pixels ("yxyx"), the Keras convention.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


# ── Box level ──────────────────────────────────────────────────────────────

def iou_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Pairwise IoU between boxes a (N,4) and b (M,4), yxyx."""
    a = np.asarray(a, dtype=np.float64).reshape(-1, 4)
    b = np.asarray(b, dtype=np.float64).reshape(-1, 4)
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)))
    y1 = np.maximum(a[:, None, 0], b[None, :, 0])
    x1 = np.maximum(a[:, None, 1], b[None, :, 1])
    y2 = np.minimum(a[:, None, 2], b[None, :, 2])
    x2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(y2 - y1, 0, None) * np.clip(x2 - x1, 0, None)
    area_a = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1])
    area_b = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    return inter / np.maximum(area_a[:, None] + area_b[None, :] - inter, 1e-9)


def match_frame(gt: np.ndarray, pred: np.ndarray, scores: np.ndarray, iou_thr: float = 0.5) -> np.ndarray:
    """Greedy COCO-style matching in descending score order. Returns TP flag per prediction."""
    order = np.argsort(-np.asarray(scores))
    pred = np.asarray(pred).reshape(-1, 4)[order]
    tp = np.zeros(len(pred), dtype=bool)
    if len(gt) == 0 or len(pred) == 0:
        out = np.zeros(len(order), dtype=bool)
        return out
    ious = iou_matrix(pred, gt)
    taken = np.zeros(len(gt), dtype=bool)
    for i in range(len(pred)):
        candidates = np.where(~taken & (ious[i] >= iou_thr))[0]
        if len(candidates):
            j = candidates[np.argmax(ious[i, candidates])]
            taken[j] = True
            tp[i] = True
    out = np.zeros(len(order), dtype=bool)
    out[order] = tp
    return out


def average_precision(frames: list[dict], iou_thr: float = 0.5) -> dict:
    """AP over a list of frames, each {"gt": (N,4), "pred": (M,4), "scores": (M,)}.

    101-point interpolated precision (COCO style) at one IoU threshold.
    """
    all_scores, all_tp, n_gt = [], [], 0
    for f in frames:
        gt = np.asarray(f["gt"]).reshape(-1, 4)
        n_gt += len(gt)
        if len(f["scores"]):
            all_scores.append(np.asarray(f["scores"], dtype=np.float64))
            all_tp.append(match_frame(gt, f["pred"], f["scores"], iou_thr))
    if n_gt == 0:
        return {"ap": float("nan"), "n_gt": 0, "n_pred": 0}
    if not all_scores:
        return {"ap": 0.0, "n_gt": n_gt, "n_pred": 0}
    scores = np.concatenate(all_scores)
    tp = np.concatenate(all_tp)[np.argsort(-scores)]
    cum_tp = np.cumsum(tp)
    precision = cum_tp / np.arange(1, len(tp) + 1)
    recall = cum_tp / n_gt
    # precision envelope, then sample at 101 recall points
    envelope = np.maximum.accumulate(precision[::-1])[::-1]
    points = np.linspace(0, 1, 101)
    idx = np.searchsorted(recall, points, side="left")
    sampled = np.where(idx < len(envelope), envelope[np.minimum(idx, len(envelope) - 1)], 0.0)
    return {"ap": float(sampled.mean()), "n_gt": n_gt, "n_pred": int(len(scores)),
            "max_recall": float(recall[-1])}


# ── Frame level ────────────────────────────────────────────────────────────

@dataclass
class FrameScores:
    precision: float
    recall: float
    f1: float
    threshold: float
    tp: int
    fp: int
    fn: int
    tn: int


def frame_scores(has_smoke: np.ndarray, frame_score: np.ndarray, threshold: float) -> FrameScores:
    """Frame-level confusion at one threshold. frame_score = max detection score (0 if none)."""
    y = np.asarray(has_smoke, dtype=bool)
    p = np.asarray(frame_score, dtype=np.float64) >= threshold
    tp, fp = int((p & y).sum()), int((p & ~y).sum())
    fn, tn = int((~p & y).sum()), int((~p & ~y).sum())
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return FrameScores(precision, recall, f1, float(threshold), tp, fp, fn, tn)


def best_f1_threshold(has_smoke: np.ndarray, frame_score: np.ndarray) -> FrameScores:
    """Sweep thresholds; choose on a validation set, then apply unchanged to test."""
    candidates = np.unique(np.concatenate([np.linspace(0.05, 0.95, 19), np.asarray(frame_score)]))
    best = max((frame_scores(has_smoke, frame_score, t) for t in candidates), key=lambda s: (s.f1, -s.threshold))
    return best


# ── Sequence level ─────────────────────────────────────────────────────────

def sequence_metrics(sequences: list[dict], within_minutes: float = 10.0) -> dict:
    """Time to detect and false alarms over sequences.

    Each sequence: {
        "fire_event": str | None,     # None for a fire-free (negative) sequence
        "camera": str,
        "onset_s": float | None,      # onset time in seconds (None for negatives)
        "alert_times_s": list[float], # times the system raised an alert
        "duration_s": float,          # how long the camera was watched
    }

    Rules (SmokeyNet / Pyronear convention):
      * an alert at or after onset detects the fire event; time to detect is
        measured from onset (the first visible smoke), never from ignition
      * an alert before onset in a fire sequence, or any alert in a fire-free
        sequence, is a false alarm
      * a fire event seen by several cameras is detected at its earliest alert
    """
    by_event: dict[str, float | None] = {}
    false_alarms, watched_s = 0, 0.0
    for s in sequences:
        alerts = np.sort(np.asarray(s["alert_times_s"], dtype=np.float64))
        watched_s += float(s["duration_s"])
        if s["fire_event"] is None:
            false_alarms += len(alerts)
            continue
        onset = float(s["onset_s"])
        false_alarms += int((alerts < onset).sum())
        after = alerts[alerts >= onset]
        ttd = float(after[0] - onset) / 60 if len(after) else None
        prev = by_event.get(s["fire_event"], "unset")
        if prev == "unset" or prev is None:
            by_event[s["fire_event"]] = ttd
        elif ttd is not None:
            by_event[s["fire_event"]] = min(prev, ttd)

    ttds = np.array([t for t in by_event.values() if t is not None])
    n_events = len(by_event)
    camera_days = watched_s / 86400
    return {
        "fire_events": n_events,
        "detected": int(len(ttds)),
        "event_recall": len(ttds) / n_events if n_events else float("nan"),
        "ttd_mean_min": float(ttds.mean()) if len(ttds) else None,
        "ttd_median_min": float(np.median(ttds)) if len(ttds) else None,
        f"detected_within_{int(within_minutes)}_min": float((ttds <= within_minutes).sum() / n_events) if n_events else float("nan"),
        "false_alarms": false_alarms,
        "camera_days": round(camera_days, 3),
        "false_alarms_per_camera_day": false_alarms / camera_days if camera_days else None,
    }
