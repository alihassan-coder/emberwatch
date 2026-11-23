"""How E2 looks at a photo: its tiles, plus the whole photo.

E1 only looked at 224x224 tiles at full resolution. That finds a far-away
plume a few pixels wide, but a close-up fire whose smoke fills the picture
looks like plain grey in every tile. So E2 also squeezes the whole photo
into one 224x224 view. A photo's smoke score is the highest of all views.

Very large photos are shrunk first so the long side is at most 1280 px (the
size of the tower cameras), which keeps the tile count, and the time per
photo, bounded.

The API repeats exactly these steps (apps/api/src/smoke_model.py); the
model spec records them.
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from src.data.tiles import TileLayout

TILE = 224
MAX_SIDE = 1280
PAD_VALUE = 114


def fit(img: Image.Image, max_side: int = MAX_SIDE) -> Image.Image:
    """Shrink so the long side is at most `max_side`; never enlarge."""
    scale = max_side / max(img.size)
    if scale >= 1:
        return img
    return img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.BILINEAR)


def whole_view(img: Image.Image) -> np.ndarray:
    """The whole photo squeezed to TILE x TILE (aspect ratio not kept)."""
    return np.asarray(img.resize((TILE, TILE), Image.Resampling.BILINEAR), dtype=np.float32)


def tile_views(img: Image.Image) -> tuple[np.ndarray, list[tuple[int, int]]]:
    """Full-resolution tiles, padded if the photo is smaller than one tile."""
    frame = np.asarray(img, dtype=np.float32)
    h, w = frame.shape[:2]
    if h < TILE or w < TILE:
        padded = np.full((max(h, TILE), max(w, TILE), 3), PAD_VALUE, dtype=np.float32)
        padded[:h, :w] = frame
        frame, (h, w) = padded, padded.shape[:2]
    origins = TileLayout.for_frame(h, w, TILE).origins()
    return np.stack([frame[y:y + TILE, x:x + TILE] for y, x in origins]), origins


def photo_views(img: Image.Image) -> np.ndarray:
    """All views of one photo: its tiles, then the whole photo last."""
    img = fit(img.convert("RGB"))
    tiles, _ = tile_views(img)
    return np.concatenate([tiles, whole_view(img)[None]])


SPEC = {
    "max_side": MAX_SIDE,
    "tile": TILE,
    "pad_value": PAD_VALUE,
    "whole_view": "whole photo resized to tile x tile, bilinear, aspect ratio not kept",
    "resize": "PIL bilinear",
    "frame_score": "max over tile probabilities and the whole-photo probability",
}
