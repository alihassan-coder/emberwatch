"""D-Fire: 21,527 varied fire and smoke photos (CC0), for the E2 model.

Why: E1 only saw distant plumes from French tower cameras (Pyro-SDIS). Shown
a close-up photo of a forest fire, with smoke filling half the picture, it
scored 0.1%. D-Fire has close-up, aerial, CCTV and wildfire photos, plus
9,838 photos with no fire at all (fog, clouds, sunsets, city lights), so the
model learns what smoke looks like at every scale, and what it isn't.

Source: https://github.com/gaiasd/DFireDataset (CC0 1.0), used through the
Kaggle copy `sayedgamal99/smoke-fire-detection-yolo`, which keeps the
original images and YOLO labels in train/val/test folders. Classes: 0 smoke,
1 fire. Both count as "something to alert on".

Run on Kaggle to print a summary:
    python -m src.data.dfire
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

from src.common.env import ML_ROOT, ON_KAGGLE

KAGGLE_SLUG = "sayedgamal99/smoke-fire-detection-yolo"
SPLITS = {"train": "train", "val": "val", "test": "test"}


def find_root() -> Path:
    """The folder holding train/ val/ test/ (each with images/ and labels/)."""
    roots = [Path("/kaggle/input")] if ON_KAGGLE else [ML_ROOT / "data" / "raw"]
    for root in roots:
        for hit in sorted(root.glob("**/train/images")):
            if (hit.parent / "labels").is_dir() and (hit.parent.parent / "test" / "images").is_dir():
                return hit.parent.parent
    raise FileNotFoundError(f"D-Fire not found under {roots}; attach the Kaggle dataset {KAGGLE_SLUG}")


def read_labels(label_file: Path, width: int, height: int) -> np.ndarray:
    """YOLO lines 'class cx cy w h' (0-1) -> (n, 5) array of [class, y1, x1, y2, x2] in pixels."""
    if not label_file.exists():
        return np.zeros((0, 5), dtype=np.float32)
    rows = []
    for line in label_file.read_text().split("\n"):
        parts = line.split()
        if len(parts) != 5:
            continue
        cls, cx, cy, bw, bh = int(parts[0]), *map(float, parts[1:])
        rows.append([cls, (cy - bh / 2) * height, (cx - bw / 2) * width, (cy + bh / 2) * height, (cx + bw / 2) * width])
    return np.array(rows, dtype=np.float32).reshape(-1, 5)


def load_index(limit_per_split: int | None = None) -> pd.DataFrame:
    """One row per photo: split, path, size, boxes, and whether it shows smoke or fire."""
    root = find_root()
    rows = []
    for split, folder in SPLITS.items():
        images = sorted((root / folder / "images").glob("*.jpg"))
        if limit_per_split:
            images = images[:limit_per_split]
        for path in images:
            with Image.open(path) as img:  # reads the header only
                width, height = img.size
            boxes = read_labels(root / folder / "labels" / f"{path.stem}.txt", width, height)
            classes = set(boxes[:, 0].astype(int).tolist())
            rows.append({
                "split": split, "path": str(path), "width": width, "height": height,
                "boxes": boxes, "has_smoke": 0 in classes, "has_fire": 1 in classes,
            })
    df = pd.DataFrame(rows)
    df["positive"] = df["has_smoke"] | df["has_fire"]
    return df


def crop_label(boxes: np.ndarray, y: float, x: float, size_h: float, size_w: float,
               min_box_share: float = 0.3, min_crop_share: float = 0.15) -> int:
    """1 if a smoke/fire box is mostly inside the crop, or fills a good part of it.

    The first rule is the tile rule from E1 (a box with 30% of its area inside).
    The second catches big smoke: a plume much larger than the crop still
    counts when it covers 15% of what the crop shows.
    """
    if len(boxes) == 0:
        return 0
    b = boxes[:, 1:]
    iy = np.clip(np.minimum(b[:, 2], y + size_h) - np.maximum(b[:, 0], y), 0, None)
    ix = np.clip(np.minimum(b[:, 3], x + size_w) - np.maximum(b[:, 1], x), 0, None)
    inter = iy * ix
    box_area = np.maximum((b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1]), 1e-9)
    return int(np.any(inter / box_area >= min_box_share) or np.any(inter / (size_h * size_w) >= min_crop_share))


def main() -> None:
    df = load_index()
    summary = df.groupby("split").agg(photos=("path", "size"), smoke=("has_smoke", "sum"),
                                      fire=("has_fire", "sum"), positive=("positive", "sum"))
    print(summary.to_string())
    print("median size:", int(df["width"].median()), "x", int(df["height"].median()))


if __name__ == "__main__":
    main()
