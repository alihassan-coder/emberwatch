"""The tile layout: the API cuts photos the same way, so this must not drift."""

import numpy as np
import pytest

from src.data.tiles import TileLayout, cut, tile_labels


def test_tower_frames_use_a_6_by_4_grid_covering_the_edges():
    layout = TileLayout()
    origins = layout.origins()
    assert layout.n_tiles == 24
    assert origins[0] == (0, 0)
    assert origins[-1] == (720 - 224, 1280 - 224)       # last tile touches the bottom-right corner


def test_any_frame_size_gets_ceil_side_over_tile_tiles():
    assert TileLayout.for_frame(960, 1280).n_tiles == 5 * 6
    assert TileLayout.for_frame(224, 224).n_tiles == 1


def test_cut_returns_tiles_and_rejects_the_wrong_size():
    layout = TileLayout()
    frame = np.zeros((720, 1280, 3), np.float32)
    assert cut(frame, layout).shape == (24, 224, 224, 3)
    with pytest.raises(ValueError, match="layout expects"):
        cut(np.zeros((540, 960, 3)), layout)


def test_a_small_box_marks_only_the_tiles_holding_most_of_it():
    layout = TileLayout()
    labels = tile_labels(np.array([[10, 10, 40, 40]]), layout)    # top-left corner
    assert labels[0] == 1 and labels.sum() == 1


def test_a_box_that_only_clips_a_tile_edge_does_not_count():
    layout = TileLayout()
    y, x = layout.origins()[1]
    box = np.array([[0, x - 100, 50, x + 5]])    # 5 px of a 105 px box inside tile 1
    assert tile_labels(box, layout)[1] == 0


def test_no_boxes_means_no_smoke():
    assert tile_labels(np.zeros((0, 4)), TileLayout()).sum() == 0
