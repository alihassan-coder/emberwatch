/*
  Demo data for the Watch and Alerts screens.

  Until the replay service exists (Phase 2), these screens run on this fixed,
  hand-built scenario. The UI labels it as a demo. Camera ids use real HPWREN
  station codes from FIgLib; positions are approximate.

  Everything here is deterministic (seeded), because Next.js Cache Components
  prerenders pages and forbids Math.random() during rendering.
*/

import { bearing, crossBearings, type LatLon } from "./geo";
import type { Alert, Camera, CameraState } from "./types";

/** Small seeded PRNG (mulberry32), so the demo looks the same on every load. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where the demo fire is burning. */
export const DEMO_FIRE: LatLon = { lat: 32.742, lon: -116.618 };

const HISTORY_MIN = 40;

/** Score history: quiet noise, then a climb `riseAt` minutes in, if the camera sees smoke. */
function history(seed: number, peak: number | null, riseAt = 31): number[] {
  const rnd = seeded(seed);
  return Array.from({ length: HISTORY_MIN }, (_, m) => {
    const base = 0.05 + rnd() * 0.12;
    if (peak === null || m < riseAt) return base;
    const t = Math.min(1, (m - riseAt + 1) / 6);
    return Math.min(0.99, base + (peak - base) * t + (rnd() - 0.5) * 0.04);
  });
}

function stateFor(score: number): CameraState {
  if (score >= 0.85) return "fire";
  if (score >= 0.55) return "suspect";
  return "clear";
}

type CameraSeed = Omit<Camera, "state" | "score" | "scoreHistory" | "plume"> & { peak: number | null };

const SEEDS: CameraSeed[] = [
  { id: "lp-e", station: "lp", name: "Lyons Peak east", position: { lat: 32.7, lon: -116.762 }, azimuth: 70, fov: 90, frameAgeSec: 18, scene: 11, peak: 0.91 },
  { id: "ml-sw", station: "ml", name: "Mount Laguna southwest", position: { lat: 32.867, lon: -116.418 }, azimuth: 230, fov: 90, frameAgeSec: 41, scene: 23, peak: 0.87 },
  { id: "om-n", station: "om", name: "Otay Mountain north", position: { lat: 32.6, lon: -116.84 }, azimuth: 350, fov: 90, frameAgeSec: 27, scene: 37, peak: null },
  { id: "hp-w", station: "hp", name: "High Point west", position: { lat: 33.36, lon: -116.84 }, azimuth: 285, fov: 90, frameAgeSec: 9, scene: 41, peak: null },
  { id: "rm-s", station: "rm", name: "Red Mountain south", position: { lat: 33.4, lon: -117.19 }, azimuth: 185, fov: 90, frameAgeSec: 52, scene: 53, peak: null },
  { id: "smer-e", station: "smer", name: "Santa Margarita east", position: { lat: 33.48, lon: -117.15 }, azimuth: 95, fov: 90, frameAgeSec: 33, scene: 67, peak: 0.62 },
];

export const DEMO_CAMERAS: Camera[] = SEEDS.map(({ peak, ...cam }, i) => {
  const scoreHistory = history(100 + i, peak, cam.id === "smer-e" ? 34 : 31);
  const score = scoreHistory[scoreHistory.length - 1];
  let plume: Camera["plume"];
  if (peak !== null && cam.id !== "smer-e") {
    // Put the plume where the camera would actually see the demo fire.
    const offset = ((bearing(cam.position, DEMO_FIRE) - cam.azimuth + 540) % 360) - 180;
    plume = { x: 0.5 + offset / cam.fov, y: 0.5, size: 0.11 };
  } else if (cam.id === "smer-e") {
    plume = { x: 0.33, y: 0.58, size: 0.08 }; // dust from a quarry road: the hard negative
  }
  return { ...cam, scoreHistory, score, state: stateFor(score), plume };
});

export const cameraById = (id: string) => DEMO_CAMERAS.find((c) => c.id === id);

function timeline(seed: number, peak: number) {
  const rnd = seeded(seed);
  return Array.from({ length: 21 }, (_, i) => {
    const minute = i - 10;
    const s = minute < -2 ? 0.08 + rnd() * 0.15 : Math.min(0.98, 0.45 + (minute + 3) * 0.06 + rnd() * 0.05);
    return { minute, score: Math.min(s, minute >= 0 ? peak : s) };
  });
}

const lp = DEMO_CAMERAS[0];
const ml = DEMO_CAMERAS[1];

export const DEMO_ALERTS: Alert[] = [
  {
    id: "A-2611",
    cameraIds: [lp.id, ml.id],
    bearings: { [lp.id]: bearing(lp.position, DEMO_FIRE), [ml.id]: bearing(ml.position, DEMO_FIRE) },
    firstAlertMinAgo: 6,
    peakScore: 0.91,
    status: "needs_review",
    location:
      crossBearings(lp.position, bearing(lp.position, DEMO_FIRE), ml.position, bearing(ml.position, DEMO_FIRE)) ??
      undefined,
    timeline: timeline(7, 0.91),
  },
  {
    id: "A-2610",
    cameraIds: ["smer-e"],
    bearings: { "smer-e": 82 },
    firstAlertMinAgo: 2,
    peakScore: 0.62,
    status: "needs_review",
    timeline: timeline(9, 0.62),
  },
  {
    id: "A-2607",
    cameraIds: ["rm-s"],
    bearings: { "rm-s": 171 },
    firstAlertMinAgo: 134,
    peakScore: 0.58,
    status: "dismissed",
    dismissReason: "Low cloud",
    timeline: timeline(13, 0.58),
  },
];
