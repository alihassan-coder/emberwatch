"""Time to detect on real fires (FIgLib), using the exported ONNX model.

This is the number a client cares about: how many minutes after smoke first
becomes visible (onset) does EmberWatch raise an alert, and how many false
alarms does it raise per camera per day while doing so?

Steps:
  1. score every FIgLib val/test frame with the ONNX model, exactly as the
     API will (frame score = highest tile probability)
  2. turn scores into alerts with a persistence rule: alert when the score
     passes a threshold in k of the last n frames
  3. pick the threshold and rule on VAL (most fires caught within 10 min
     while keeping false alarms <= the target), then report on TEST only

False alarms are counted on the 40 minutes of pre-onset frames in every
sequence: same cameras, same day, no visible smoke yet.

Run on Kaggle (CPU is enough; needs emberwatch-figlib and a model run attached):
    scripts/kaggle_run.sh run emberwatch-e1-ttd "src.evaluate.figlib_ttd --model-run e1_tile_classifier" \\
        --source emberwatch-figlib --source emberwatch-e1-tiles
"""

from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

from src.common.env import data_dir, find_input, git_sha, output_dir
from src.common.shards import unpack
from src.data.tiles import TileLayout, cut
from src.evaluate.metrics import frame_scores, sequence_metrics

TARGET_FALSE_ALARMS_PER_DAY = 0.5   # from docs/research/02-prior-work-and-metrics.md
RULES = [(1, 1), (2, 2), (2, 3), (3, 5)]  # (k, n): alert if k of the last n frames pass
THRESHOLDS = np.round(np.arange(0.30, 0.99, 0.02), 2)


# ── 1. Score frames ────────────────────────────────────────────────────────

class OnnxTileScorer:
    """Frame -> smoke score, using only the ONNX file and its model spec."""

    def __init__(self, model_dir: Path):
        import onnxruntime as ort

        self.spec = json.loads((model_dir / "model_spec.json").read_text())
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        self.session = ort.InferenceSession(str(model_dir / self.spec["file"]), options,
                                            providers=["CPUExecutionProvider"])
        self.input_name = self.spec["input"]["name"]
        self.tile = int(self.spec["tiling"]["tile"])

    def score(self, frame: np.ndarray) -> float:
        layout = TileLayout.for_frame(frame.shape[0], frame.shape[1], self.tile)
        tiles = cut(frame.astype(np.float32), layout)
        logits = self.session.run(None, {self.input_name: tiles})[0].reshape(-1)
        return float((1 / (1 + np.exp(-logits))).max())


def score_frames(frames: pd.DataFrame, frames_dir: Path, scorer: OnnxTileScorer) -> np.ndarray:
    def load(rel: str) -> np.ndarray:
        with Image.open(frames_dir / rel) as img:
            return np.asarray(img.convert("RGB"))

    scores = np.zeros(len(frames))
    files = frames["file"].tolist()
    started = time.time()
    # Decode in bounded batches. pool.map over every file at once queues all
    # decoded frames in memory (~3.7 MB each) faster than they are scored:
    # the first full run was killed (exit 137) after 6,000 frames.
    batch = 64
    with ThreadPoolExecutor(max_workers=4) as pool:
        for start in range(0, len(files), batch):
            for j, frame in enumerate(pool.map(load, files[start:start + batch])):
                scores[start + j] = scorer.score(frame)
            done = min(start + batch, len(files))
            if done % 1024 < batch or done == len(files):
                print(f"[score] {done}/{len(files)} frames, {(time.time() - started) / 60:.1f} min", flush=True)
    return scores


# ── 2. Scores -> alerts ────────────────────────────────────────────────────

def alert_times(epochs: np.ndarray, scores: np.ndarray, threshold: float, k: int, n: int) -> list[float]:
    """Epoch times at which the k-of-n persistence rule fires (frames in time order)."""
    hits = (scores >= threshold).astype(int)
    window = np.convolve(hits, np.ones(n, dtype=int))[: len(hits)]  # hits among the last n frames
    return epochs[window >= k].astype(float).tolist()


def to_sequences(frames: pd.DataFrame, threshold: float, k: int, n: int) -> list[dict]:
    """Inputs for metrics.sequence_metrics. Watched time = the pre-onset part,
    where every alert is a false alarm."""
    seqs = []
    for name, g in frames.sort_values("epoch").groupby("sequence"):
        epochs = g["epoch"].to_numpy()
        onset = float((g["epoch"] - g["offset_s"]).iloc[0])  # same for every frame of a sequence
        seqs.append({
            "fire_event": g["fire_event"].iloc[0], "camera": name, "onset_s": onset,
            "alert_times_s": alert_times(epochs, g["score"].to_numpy(), threshold, k, n),
            "duration_s": max(0.0, onset - float(epochs.min())),
        })
    return seqs


# ── 3. Choose on val, report on test ───────────────────────────────────────

def sweep(frames: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for k, n in RULES:
        for t in THRESHOLDS:
            m = sequence_metrics(to_sequences(frames, t, k, n))
            rows.append({"rule": f"{k} of {n}", "k": k, "n": n, "threshold": float(t), **m})
    return pd.DataFrame(rows)


def choose(val_sweep: pd.DataFrame) -> pd.Series:
    ok = val_sweep[val_sweep["false_alarms_per_camera_day"] <= TARGET_FALSE_ALARMS_PER_DAY]
    pool = ok if len(ok) else val_sweep.nsmallest(5, "false_alarms_per_camera_day")
    return pool.sort_values(["detected_within_10_min", "ttd_mean_min"], ascending=[False, True]).iloc[0]


def main() -> None:
    ap = argparse.ArgumentParser(description="FIgLib time-to-detect")
    ap.add_argument("--model-run", default="e1_tile_classifier", help="folder holding model.onnx + model_spec.json")
    ap.add_argument("--limit-seqs", type=int, default=None, help="quick run: this many sequences per split")
    args = ap.parse_args()

    model_dir = find_input(f"{args.model_run}/model_spec.json").parent
    figlib_dir = find_input("figlib/frames.parquet").parent
    frames = pd.read_parquet(figlib_dir / "frames.parquet")
    frames = frames[frames["split"].isin(["val", "test"])]
    if args.limit_seqs:
        keep = frames.groupby("split")["sequence"].unique().apply(lambda s: list(s[: args.limit_seqs])).sum()
        frames = frames[frames["sequence"].isin(keep)]

    out = output_dir() / f"ttd_{args.model_run}"
    out.mkdir(parents=True, exist_ok=True)
    scorer = OnnxTileScorer(model_dir)
    for split in ["val", "test"]:
        dest = unpack(figlib_dir, data_dir() / "figlib_frames" / split, f"frames-{split}-*.tar")
        part = frames["split"] == split
        frames.loc[part, "score"] = score_frames(frames[part], dest, scorer)
    frames.to_parquet(out / "frame_scores.parquet", index=False)  # save before any reporting

    val, test = frames[frames["split"] == "val"], frames[frames["split"] == "test"]
    val_sweep = sweep(val)
    val_sweep.to_csv(out / "val_sweep.csv", index=False)
    best = choose(val_sweep)
    test_m = sequence_metrics(to_sequences(test, best["threshold"], int(best["k"]), int(best["n"])))
    test_frame = frame_scores(test["smoke_visible"].to_numpy(), test["score"].to_numpy(), best["threshold"])
    spec_threshold = scorer.spec.get("threshold")

    result = {
        "model": scorer.spec.get("name"), "model_version": scorer.spec.get("version"), "git_sha": git_sha(),
        "chosen_on_val": {"rule": best["rule"], "threshold": best["threshold"]},
        "val": {k: best[k] for k in ["event_recall", "ttd_mean_min", "ttd_median_min",
                                     "detected_within_10_min", "false_alarms_per_camera_day"]},
        "test": test_m, "test_frame_level": test_frame.__dict__,
        "pyro_sdis_threshold_for_reference": spec_threshold,
    }
    (out / "ttd.json").write_text(json.dumps(result, indent=2, default=float))

    def pct(x):
        return "n/a" if x is None or x != x else f"{x:.0%}"

    def num(x, unit=""):
        return "n/a" if x is None or x != x else f"{x:.2f}{unit}"

    lines = [
        f"# Time to detect on real fires (FIgLib): {result['model']} {result['model_version']}",
        "",
        f"Alert rule chosen on val: **{best['rule']} frames ≥ {best['threshold']:.2f}** "
        f"(target ≤ {TARGET_FALSE_ALARMS_PER_DAY} false alarms per camera-day).",
        "",
        "| | Fires caught | Within 10 min | Mean time to detect | Median | False alarms / camera-day |",
        "|---|---|---|---|---|---|",
        f"| val | {pct(best['event_recall'])} | {pct(best['detected_within_10_min'])} | "
        f"{num(best['ttd_mean_min'], ' min')} | {num(best['ttd_median_min'], ' min')} | "
        f"{num(best['false_alarms_per_camera_day'])} |",
        f"| **test ({test_m['fire_events']} fire events)** | **{pct(test_m['event_recall'])}** | "
        f"**{pct(test_m['detected_within_10_min'])}** | **{num(test_m['ttd_mean_min'], ' min')}** | "
        f"{num(test_m['ttd_median_min'], ' min')} | **{num(test_m['false_alarms_per_camera_day'])}** |",
        "",
        f"Test frame-level: precision {test_frame.precision:.3f}, recall {test_frame.recall:.3f}, F1 {test_frame.f1:.3f}.",
        "",
        "Targets (docs/research/02): mean ≤ 3 min, ≥ 90% within 10 min, ≤ 0.5 false alarms per camera-day. "
        "SmokeyNet: 3.12 min mean on FIgLib.",
        "",
        "Time is measured from onset (first frame with visible smoke), never from ignition.",
        "Data courtesy of HPWREN, University of California San Diego (https://www.hpwren.ucsd.edu/).",
    ]
    (out / "report.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines), flush=True)


if __name__ == "__main__":
    main()
