"""E2's views of a photo (tiles + whole photo). apps/api/src/smoke_model.py repeats these steps."""

import numpy as np
from PIL import Image

from src.data.views import MAX_SIDE, TILE, fit, photo_views, tile_views, whole_view


def test_big_photos_shrink_to_the_tower_camera_size_and_small_ones_are_not_enlarged():
    assert fit(Image.new("RGB", (4000, 3000))).size == (MAX_SIDE, 960)
    assert fit(Image.new("RGB", (745, 425))).size == (745, 425)


def test_the_whole_photo_is_the_last_view():
    img = Image.new("RGB", (745, 425))
    img.paste((255, 255, 255), (0, 0, 745, 425))
    views = photo_views(img)
    assert views.shape == (2 * 4 + 1, TILE, TILE, 3)
    assert np.allclose(views[-1], whole_view(img))


def test_photos_smaller_than_a_tile_are_padded_not_stretched():
    tiles, origins = tile_views(Image.new("RGB", (150, 100), (10, 10, 10)))
    assert tiles.shape == (1, TILE, TILE, 3) and origins == [(0, 0)]
    assert tiles[0, 0, 0, 0] == 10 and tiles[0, -1, -1, 0] == 114     # photo, then grey padding
