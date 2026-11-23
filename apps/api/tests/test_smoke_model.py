"""How a photo is turned into model views (tiles, and the whole photo for E2+ models)."""

import numpy as np
import pytest

from src.smoke_model import SmokeModel


class FakeSession:
    """Stands in for onnxruntime: logit = mean brightness of the view, scaled, so bright views score high."""

    def __init__(self):
        self.batches = []

    def run(self, _outputs, feeds):
        batch = next(iter(feeds.values()))
        self.batches.append(batch)
        return [((batch.mean(axis=(1, 2, 3)) - 128) / 10).reshape(-1, 1)]


def make_model(views: bool) -> SmokeModel:
    model = SmokeModel.__new__(SmokeModel)
    model.spec = {"name": "m", "version": "v"}
    model._version = "v"
    model.session = FakeSession()
    model.input_name = "tiles"
    model.tile = 224
    model.threshold = 0.5
    model.views = {"max_side": 1280} if views else None
    return model


def test_e1_models_score_tiles_only():
    model = make_model(views=False)
    result = model.score(np.zeros((425, 745, 3), np.uint8))
    assert result.whole is None
    assert len(result.tiles) == 2 * 4                    # ceil(425/224) x ceil(745/224)
    assert model.session.batches[0].shape == (8, 224, 224, 3)


def test_e2_models_add_the_whole_photo_as_the_last_view():
    model = make_model(views=True)
    result = model.score(np.zeros((425, 745, 3), np.uint8))
    assert model.session.batches[0].shape == (9, 224, 224, 3)   # 8 tiles + whole photo
    assert result.whole is not None
    assert len(result.tiles) == 8                                # the whole view is not a tile


def test_smoke_that_fills_the_photo_counts_through_the_whole_view():
    """A photo that is bright everywhere except a dark border: tiles at the edges
    are dark, but the whole-photo view is mostly bright, so the photo scores high."""
    model = make_model(views=True)
    frame = np.full((448, 448, 3), 255, np.uint8)
    frame[:, :40] = frame[:, -40:] = frame[:40] = frame[-40:] = 0
    result = model.score(frame)
    assert result.score == pytest.approx(max(result.whole, *(t.probability for t in result.tiles)))


def test_big_photos_are_shrunk_before_tiling():
    model = make_model(views=True)
    result = model.score(np.zeros((3000, 4000, 3), np.uint8))
    assert (result.width, result.height) == (1280, 960)
    assert len(result.tiles) == 5 * 6


def test_tiny_photos_are_padded_to_one_tile():
    result = make_model(views=True).score(np.zeros((100, 150, 3), np.uint8))
    assert (result.width, result.height) == (224, 224)
    assert len(result.tiles) == 1
