"""Compass geometry used to locate plumes."""

import pytest

from src.services.geo import angle_between, cross_bearings, distance_km


def test_angle_between_wraps_around_north():
    assert angle_between(350, 10) == pytest.approx(20)
    assert angle_between(90, 270) == pytest.approx(180)
    assert angle_between(45, 45) == pytest.approx(0)


def test_distance_one_degree_of_latitude_is_about_111_km():
    assert distance_km(43.0, 7.0, 44.0, 7.0) == pytest.approx(111.2, abs=0.5)


def test_bearings_cross_between_two_towers():
    # Towers 20 km apart on the same latitude, looking at 60 and 300 degrees.
    fix = cross_bearings(43.70, 7.00, 60, 43.70, 7.2483, 300)
    assert fix is not None
    lat, lon = fix
    assert lon == pytest.approx(7.124, abs=0.01)          # halfway between the towers
    assert distance_km(43.70, 7.124, lat, lon) == pytest.approx(5.8, abs=0.5)  # ~6 km north
    assert lat > 43.70


def test_lines_crossing_behind_a_camera_give_no_location():
    # The east tower looks south-east: the lines only meet behind it.
    assert cross_bearings(43.70, 7.00, 60, 43.70, 7.2483, 120) is None


def test_parallel_bearings_give_no_location():
    assert cross_bearings(43.70, 7.00, 0, 43.70, 7.2483, 0) is None
