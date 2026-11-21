"""Where am I running, and where do inputs/outputs live?

The same code runs locally (CPU laptop) and on Kaggle (GPU). Only these
paths differ; everything else is identical.
"""

from __future__ import annotations

import os
from pathlib import Path

ML_ROOT = Path(__file__).resolve().parents[2]  # .../emberwatch/ml

ON_KAGGLE = "KAGGLE_KERNEL_RUN_TYPE" in os.environ or Path("/kaggle/working").exists()


def output_dir() -> Path:
    """Where a run writes results (models, metrics, reports)."""
    if override := os.environ.get("EMBERWATCH_OUT"):
        path = Path(override)
    elif ON_KAGGLE:
        path = Path("/kaggle/working")
    else:
        path = ML_ROOT / "artifacts" / "local"
    path.mkdir(parents=True, exist_ok=True)
    return path


def data_dir() -> Path:
    """Scratch space for raw downloads (not kept as run output)."""
    if override := os.environ.get("EMBERWATCH_DATA"):
        path = Path(override)
    elif ON_KAGGLE:
        path = Path("/tmp/emberwatch-data")  # local disk, not saved as output
    else:
        path = ML_ROOT / "data" / "raw"
    path.mkdir(parents=True, exist_ok=True)
    return path


def find_input(relative: str) -> Path:
    """Locate a file produced by an earlier Kaggle run attached as input.

    Kaggle mounts attached notebook outputs under /kaggle/input/<...>/; the
    exact prefix has changed over time, so search instead of hard-coding it.
    Locally, look in ml/artifacts/.
    """
    roots = [Path("/kaggle/input")] if ON_KAGGLE else [ML_ROOT / "artifacts"]
    for root in roots:
        hits = sorted(root.glob(f"**/{relative}"))
        if hits:
            return hits[0]
    raise FileNotFoundError(f"{relative!r} not found under {roots}")


def git_sha() -> str:
    return os.environ.get("EMBERWATCH_GIT_SHA", "local")
