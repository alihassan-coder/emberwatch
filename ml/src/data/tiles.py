"""Cut a frame into overlapping square tiles, and decide which tiles show smoke.

Why tiles: smoke in our cameras is tiny (median box ~0.1% of the frame), so
shrinking a whole 1280x720 frame to a CNN's 224x224 input would erase it.
Instead each frame is cut into 224x224 tiles at full resolution and a
classifier answers "smoke in this tile?". A frame's smoke score is its
highest tile score. Same idea as SmokeyNet (Dewangan et al., 2022).

The API must tile frames exactly like this at inference time, so the layout
is written into the exported model spec (see TileLayout.as_dict).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np


@dataclass(frozen=True)
class TileLayout:
    frame_h: int = 720
    frame_w: int = 1280
    tile: int = 224
    rows: int = 4  # 4 x 224 = 896 > 720, so rows overlap a little
    cols: int = 6  # 6 x 224 = 1344 > 1280, so columns overlap a little

    def origins(self) -> list[tuple[int, int]]:
        """Top-left (y, x) of every tile, evenly spread so the edges are covered."""
        ys = np.linspace(0, self.frame_h - self.tile, self.rows).round().astype(int)
        xs = np.linspace(0, self.frame_w - self.tile, self.cols).round().astype(int)
        return [(int(y), int(x)) for y in ys for x in xs]

    @property
    def n_tiles(self) -> int:
        return self.rows * self.cols

    def as_dict(self) -> dict:
        return asdict(self) | {"origins_yx": self.origins()}


def cut(frame: np.ndarray, layout: TileLayout) -> np.ndarray:
    """(H, W, 3) frame -> (n_tiles, tile, tile, 3). Frame must match the layout size."""
    h, w = frame.shape[:2]
    if (h, w) != (layout.frame_h, layout.frame_w):
        raise ValueError(f"frame is {w}x{h}, layout expects {layout.frame_w}x{layout.frame_h}")
    t = layout.tile
    return np.stack([frame[y:y + t, x:x + t] for y, x in layout.origins()])


def tile_labels(boxes_yxyx: np.ndarray, layout: TileLayout, min_box_share: float = 0.3) -> np.ndarray:
    """1 for each tile holding at least `min_box_share` of some smoke box's area, else 0.

    A share (not "any overlap") keeps a tile from being called smoke just
    because the corner of a plume clips its edge. Most boxes are much smaller
    than a tile, so in practice the tile that contains a box gets label 1.
    """
    labels = np.zeros(layout.n_tiles, dtype=np.int32)
    boxes = np.asarray(boxes_yxyx, dtype=np.float64).reshape(-1, 4)
    if len(boxes) == 0:
        return labels
    areas = np.maximum((boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1]), 1e-9)
    for i, (y, x) in enumerate(layout.origins()):
        iy = np.clip(np.minimum(boxes[:, 2], y + layout.tile) - np.maximum(boxes[:, 0], y), 0, None)
        ix = np.clip(np.minimum(boxes[:, 3], x + layout.tile) - np.maximum(boxes[:, 1], x), 0, None)
        if np.any(iy * ix / areas >= min_box_share):
            labels[i] = 1
    return labels
