// Small geometry helpers for the Fire Finder map.
// Positions are lat/lon degrees; bearings are compass degrees (0 = north, clockwise).

export type LatLon = { lat: number; lon: number };

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Compass bearing from a to b, 0-360. */
export function bearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Great-circle distance in km. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Point reached by travelling `km` from `from` along compass `bearingDeg` (flat approximation, fine under ~100 km). */
export function travel(from: LatLon, bearingDeg: number, km: number): LatLon {
  const dLat = (km * Math.cos(toRad(bearingDeg))) / 111.32;
  const dLon = (km * Math.sin(toRad(bearingDeg))) / (111.32 * Math.cos(toRad(from.lat)));
  return { lat: from.lat + dLat, lon: from.lon + dLon };
}

/**
 * Where two bearing lines cross: the location estimate when two cameras see
 * the same plume. Returns null when the lines are (nearly) parallel.
 */
export function crossBearings(a: LatLon, bearingA: number, b: LatLon, bearingB: number): LatLon | null {
  // Work in a local flat frame (km east, km north) around a.
  const kx = 111.32 * Math.cos(toRad(a.lat));
  const ky = 111.32;
  const bx = (b.lon - a.lon) * kx;
  const by = (b.lat - a.lat) * ky;
  const dax = Math.sin(toRad(bearingA)), day = Math.cos(toRad(bearingA));
  const dbx = Math.sin(toRad(bearingB)), dby = Math.cos(toRad(bearingB));
  const det = dax * -dby - day * -dbx;
  if (Math.abs(det) < 1e-6) return null;
  const t = (bx * -dby - by * -dbx) / det;
  if (t < 0) return null; // crossing is behind camera a
  return { lat: a.lat + (t * day) / ky, lon: a.lon + (t * dax) / kx };
}
