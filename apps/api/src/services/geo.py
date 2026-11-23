"""Compass geometry for locating plumes. Same maths as apps/web/src/lib/geo.ts."""

from __future__ import annotations

import math

KM_PER_DEG_LAT = 111.32


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    d_lat, d_lon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    h = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def angle_between(b1: float, b2: float) -> float:
    """Smallest angle between two bearings, 0-180 degrees."""
    return abs(((b1 - b2 + 540) % 360) - 180)


def cross_bearings(lat_a: float, lon_a: float, bearing_a: float,
                   lat_b: float, lon_b: float, bearing_b: float) -> tuple[float, float] | None:
    """Where two bearing lines cross (flat approximation, fine under ~100 km); None if they don't, ahead of both."""
    kx = KM_PER_DEG_LAT * math.cos(math.radians(lat_a))
    bx, by = (lon_b - lon_a) * kx, (lat_b - lat_a) * KM_PER_DEG_LAT
    dax, day = math.sin(math.radians(bearing_a)), math.cos(math.radians(bearing_a))
    dbx, dby = math.sin(math.radians(bearing_b)), math.cos(math.radians(bearing_b))
    det = dax * -dby - day * -dbx
    if abs(det) < 1e-6:
        return None
    t = (bx * -dby - by * -dbx) / det                 # distance along line a
    s = (dax * by - day * bx) / det                   # distance along line b
    if t < 0 or s < 0:
        return None                                   # the lines cross behind a camera
    return lat_a + t * day / KM_PER_DEG_LAT, lon_a + t * dax / kx
