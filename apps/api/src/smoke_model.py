"""The smoke model as the API sees it: an ONNX file plus its spec.

The API never imports Keras or the ml/ code (docs/decisions/0001, 0003).
Everything needed to use the model (input name, pixel format, how to cut a
frame into tiles, the decision threshold) is in model_spec.json, which the
training job writes next to model.onnx.

Tiling rule (must match ml/src/data/tiles.py): ceil(side / tile) tiles per
side, spread evenly so they overlap a little and cover the edges.

Models from E2 on also have a "views" section in their spec (must match
ml/src/data/views.py): big photos are first shrunk so the long side is at
most `max_side`, and the whole photo, squeezed to one tile, is scored next
to the tiles. The photo's score is the highest of all of them, so smoke that
fills the picture counts as much as a far-away plume. E1 specs have no
"views" and are scored on tiles only, as before.
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image


@dataclass(frozen=True)
class Tile:
    y: int
    x: int
    size: int
    probability: float


@dataclass(frozen=True)
class FrameResult:
    score: float          # highest probability over all views
    smoke: bool           # score >= threshold
    threshold: float
    tiles: list[Tile]
    width: int
    height: int
    latency_ms: float
    whole: float | None = None   # whole-photo probability (E2+ models), else None


def tile_origins(height: int, width: int, tile: int) -> list[tuple[int, int]]:
    rows, cols = max(1, math.ceil(height / tile)), max(1, math.ceil(width / tile))
    ys = np.linspace(0, max(0, height - tile), rows).round().astype(int)
    xs = np.linspace(0, max(0, width - tile), cols).round().astype(int)
    return [(int(y), int(x)) for y in ys for x in xs]


def fit(img: Image.Image, max_side: int) -> Image.Image:
    """Shrink so the long side is at most `max_side`; never enlarge."""
    scale = max_side / max(img.size)
    if scale >= 1:
        return img
    return img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.BILINEAR)


class SmokeModel:
    def __init__(self, model_dir: Path, threads: int = 4, version: str | None = None):
        self.spec = json.loads((model_dir / "model_spec.json").read_text())
        self._version = version or self.spec["version"]  # the store's version name, e.g. "e1-18c4671"
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        self.session = ort.InferenceSession(
            str(model_dir / self.spec["file"]), options, providers=["CPUExecutionProvider"]
        )
        self.input_name: str = self.spec["input"]["name"]
        self.tile: int = int(self.spec["tiling"]["tile"])
        self.threshold: float = float(self.spec["threshold"])
        self.views: dict | None = self.spec.get("views")

    @property
    def name(self) -> str:
        return self.spec["name"]

    @property
    def version(self) -> str:
        return self._version

    def score(self, frame: np.ndarray) -> FrameResult:
        """frame: (H, W, 3) RGB uint8. Frames smaller than one tile are padded.

        Tile positions in the result are in the (possibly shrunk) photo the
        model saw; `width` and `height` give that size.
        """
        started = time.perf_counter()
        whole_view = None
        if self.views:
            img = fit(Image.fromarray(frame), int(self.views["max_side"]))
            whole_view = np.asarray(img.resize((self.tile, self.tile), Image.Resampling.BILINEAR), dtype=np.float32)
            frame = np.asarray(img)
        frame = self._pad_to_tile(frame)
        height, width = frame.shape[:2]
        origins = tile_origins(height, width, self.tile)
        t = self.tile
        views = [frame[y:y + t, x:x + t] for y, x in origins] + ([whole_view] if whole_view is not None else [])
        logits = self.session.run(None, {self.input_name: np.stack(views).astype(np.float32)})[0].reshape(-1)
        probs = 1.0 / (1.0 + np.exp(-logits))
        whole = float(probs[-1]) if whole_view is not None else None
        tile_probs = probs[: len(origins)]
        score = float(probs.max())
        return FrameResult(
            whole=whole,
            score=score,
            smoke=score >= self.threshold,
            threshold=self.threshold,
            tiles=[Tile(y=y, x=x, size=t, probability=float(p)) for (y, x), p in zip(origins, tile_probs)],
            width=width,
            height=height,
            latency_ms=round((time.perf_counter() - started) * 1000, 1),
        )

    def _pad_to_tile(self, frame: np.ndarray) -> np.ndarray:
        h, w = frame.shape[:2]
        if h >= self.tile and w >= self.tile:
            return frame
        padded = np.full((max(h, self.tile), max(w, self.tile), 3), 114, dtype=frame.dtype)
        padded[:h, :w] = frame
        return padded
