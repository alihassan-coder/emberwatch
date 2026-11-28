"""Reading D-Fire's YOLO labels and deciding whether a crop shows smoke or fire."""

import numpy as np

from src.data.dfire import crop_label, read_labels

SMOKE = 0


def box(y1, x1, y2, x2, cls=SMOKE):
    return np.array([[cls, y1, x1, y2, x2]], np.float32)


def test_yolo_lines_become_pixel_boxes(tmp_path):
    f = tmp_path / "a.txt"
    f.write_text("0 0.5 0.5 0.2 0.4\n1 0.1 0.1 0.1 0.1\n\n")
    boxes = read_labels(f, width=1000, height=500)
    assert boxes.tolist() == [[0, 150, 400, 350, 600], [1, 25, 50, 75, 150]]


def test_a_missing_label_file_means_no_fire(tmp_path):
    assert read_labels(tmp_path / "none.txt", 640, 480).shape == (0, 5)


def test_a_crop_holding_most_of_a_box_is_positive():
    assert crop_label(box(100, 100, 200, 200), 0, 0, 224, 224) == 1


def test_a_crop_away_from_the_smoke_is_negative():
    assert crop_label(box(100, 100, 200, 200), 300, 300, 224, 224) == 0


def test_a_plume_bigger_than_the_crop_still_counts():
    # Only a small share of this huge box is inside, but it fills the whole crop.
    assert crop_label(box(0, 0, 2000, 2000), 400, 400, 224, 224) == 1


def test_a_sliver_of_smoke_at_the_crop_edge_does_not_count():
    assert crop_label(box(0, 0, 400, 230), 0, 220, 224, 224) == 0
