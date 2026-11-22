/*
  Replay engine: the pure core.

  snapshotAt(timeline, step, reviews) answers "what does the console show at
  this moment of the replay?": which frame every camera shows, which cameras
  are alerting, how alerting cameras group into plume alerts, the bearings
  to each plume and where those bearings cross.

  It is a pure function of its inputs (no clock, no randomness), so the same
  step always looks the same. That keeps Next.js prerendering happy and makes
  the alert rules easy to check.
*/

import { crossBearings, distanceKm, type LatLon } from "@/lib/geo";
import type { Manifest, ManifestCamera, ManifestFrame } from "./manifest";

/** Approximate tower positions (from place names; exact sites are not published). */
export const SITES: Record<string, { name: string; position: LatLon; approximate: "place" | "estimated" }> = {
  ferion: { name: "Mont Férion", position: { lat: 43.787, lon: 7.236 }, approximate: "place" },
  courmettes: { name: "Pic de Courmettes", position: { lat: 43.744, lon: 7.005 }, approximate: "place" },
  valbonne: { name: "Valbonne", position: { lat: 43.641, lon: 7.009 }, approximate: "place" },
  cabanelle: { name: "Cabanelle", position: { lat: 43.832, lon: 7.07 }, approximate: "estimated" },
};

export const CAMERA_FOV = 87; // degrees, typical for the tower cameras

/** Alert rule: a camera alerts once its score passes the threshold in K of the last N frames. */
export const RULE = { k: 2, n: 3 };

/**
 * Alert threshold, kept separate from the model's frame threshold.
 * The frame threshold (0.23) was picked on validation for the best frame F1,
 * which makes it trigger-happy: on the demo frames a clear Cabanelle camera
 * would raise a false alert. Until the FIgLib time-to-detect run picks the
 * alert threshold on validation fires, alerts use 0.5.
 */
export const ALERT_THRESHOLD = 0.5;
const MAX_PLUME_KM = 45; // bearings must cross within this range of both cameras

export type Timeline = {
  manifest: Manifest;
  steps: number;           // replay length in frames
  threshold: number;
};

export type Verdict = { status: "confirmed" | "dismissed"; reason?: string };
export type Reviews = Record<string, Verdict>;

export type CameraView = {
  id: string;
  siteName: string;
  heading: number;
  position: LatLon;
  unseenSite: boolean;     // the model never trained on this site
  frame: ManifestFrame;
  frameIndex: number;
  score: number;
  history: number[];       // scores up to now, oldest first
  state: "clear" | "suspect" | "fire";
  alerting: boolean;
};

export type PlumeAlert = {
  id: string;
  raisedAtStep: number;
  cameraIds: string[];
  bearings: Record<string, number>;
  location: LatLon | null;
  peakScore: number;
  verdict: Verdict | null;
};

export type Snapshot = {
  step: number;
  steps: number;
  clock: string;           // replay time of day, e.g. "12:07"
  cameras: CameraView[];
  alerts: PlumeAlert[];    // newest first
  needsReview: number;
};

export function buildTimeline(manifest: Manifest): Timeline {
  return {
    manifest,
    steps: Math.max(...manifest.cameras.map((c) => c.frames.length)),
    threshold: Math.max(ALERT_THRESHOLD, manifest.model?.threshold ?? 0),
  };
}

/** Score of a frame: the model's real score, or a stand-in when the manifest has none. */
function frameScore(f: ManifestFrame): number {
  if (typeof f.score === "number") return f.score;
  return f.smoke ? 0.9 : 0.08;
}

function stateOf(score: number, threshold: number): CameraView["state"] {
  if (score >= Math.max(0.85, threshold + 0.3)) return "fire";
  if (score >= threshold) return "suspect";
  return "clear";
}

/** First step at which the K-of-N rule fires for this camera, or null. */
function alertStep(cam: ManifestCamera, threshold: number, upTo: number): number | null {
  for (let s = 0; s <= Math.min(upTo, cam.frames.length - 1); s++) {
    let hits = 0;
    for (let i = Math.max(0, s - RULE.n + 1); i <= s; i++) hits += frameScore(cam.frames[i]) >= threshold ? 1 : 0;
    if (hits >= RULE.k) return s;
  }
  return null;
}

/** Bearing to the smoke: the camera heading, shifted by where the smoke sits in the frame. */
function bearingTo(cam: ManifestCamera, f: ManifestFrame, frameWidth: number): number {
  let x: number | null = null;
  if (f.boxes.length) x = (f.boxes[0][1] + f.boxes[0][3]) / 2;
  else if (f.tiles?.length) {
    const best = f.tiles.reduce((a, b) => (b.p > a.p ? b : a));
    x = best.x + best.size / 2;
  }
  const offset = x === null ? 0 : (x / frameWidth - 0.5) * CAMERA_FOV;
  return (cam.heading + offset + 360) % 360;
}

const pad = (n: number) => n.toString().padStart(2, "0");

export function snapshotAt(t: Timeline, rawStep: number, reviews: Reviews): Snapshot {
  const step = Math.max(0, Math.min(t.steps - 1, rawStep));
  const width = t.manifest.frame_size[0];
  const [startH, startM] = t.manifest.window[0].split(":").map(Number);
  const minutes = startH * 60 + startM + step * 6; // replay compresses ~6 minutes per frame
  const clock = `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

  const cameras: CameraView[] = t.manifest.cameras.map((cam) => {
    const i = Math.min(step, cam.frames.length - 1);
    const frame = cam.frames[i];
    const history = cam.frames.slice(0, i + 1).map(frameScore);
    const score = frameScore(frame);
    const site = SITES[cam.site];
    const started = alertStep(cam, t.threshold, step);
    return {
      id: cam.id,
      siteName: site?.name ?? cam.site,
      heading: cam.heading,
      position: site?.position ?? { lat: 43.75, lon: 7.1 },
      unseenSite: cam.split === "test",
      frame,
      frameIndex: i,
      score,
      history,
      state: stateOf(score, t.threshold),
      alerting: started !== null,
    };
  });

  // Group alerting cameras into plume alerts: cameras that start alerting
  // within a few frames of each other on the same replay are one plume.
  const starts = t.manifest.cameras
    .map((cam) => ({ cam, at: alertStep(cam, t.threshold, step) }))
    .filter((x): x is { cam: ManifestCamera; at: number } => x.at !== null)
    .sort((a, b) => a.at - b.at);

  // A camera joins a plume alert only if it started alerting around the same
  // time AND its bearing crosses the bearing of a camera already in it
  // (within range of both), or it sits on the same site.
  // Each camera's bearing is fixed at the frame where it started alerting, so
  // the location estimate doesn't jump around as the plume drifts.
  const startOf = new Map(starts.map((s) => [s.cam.id, s.at]));
  const bearingNow = (cam: ManifestCamera) => bearingTo(cam, cam.frames[startOf.get(cam.id) ?? 0], width);
  const samePlume = (a: ManifestCamera, b: ManifestCamera) => {
    if (a.site === b.site) return true;
    const pa = SITES[a.site]?.position, pb = SITES[b.site]?.position;
    if (!pa || !pb) return false;
    const angle = Math.abs(((bearingNow(a) - bearingNow(b) + 540) % 360) - 180);
    if (angle < 30 || angle > 150) return false;
    const fix = crossBearings(pa, bearingNow(a), pb, bearingNow(b));
    return !!fix && distanceKm(pa, fix) <= MAX_PLUME_KM && distanceKm(pb, fix) <= MAX_PLUME_KM;
  };
  const groups: { at: number; cams: ManifestCamera[] }[] = [];
  for (const s of starts) {
    const g = groups.find((g) => s.at - g.at <= 3 && g.cams.some((c) => samePlume(c, s.cam)));
    if (g) g.cams.push(s.cam);
    else groups.push({ at: s.at, cams: [s.cam] });
  }

  const alerts: PlumeAlert[] = groups.map((g, n) => {
    const id = `A-${2611 + n}`;
    const bearings = Object.fromEntries(g.cams.map((cam) => [cam.id, bearingNow(cam)]));
    // Location: cross two bearings from different sites. Lines that are nearly
    // parallel or nearly opposite (cameras facing each other) don't fix a point,
    // so only crossings between 30 and 150 degrees count; the one closest to
    // 90 degrees wins.
    let location: LatLon | null = null;
    let widest = 0;
    for (const a of g.cams) {
      for (const b of g.cams) {
        if (a.site >= b.site || !SITES[a.site] || !SITES[b.site]) continue;
        const angle = Math.abs(((bearings[a.id] - bearings[b.id] + 540) % 360) - 180);
        const quality = 90 - Math.abs(angle - 90); // 90 = perpendicular, best
        if (angle < 30 || angle > 150 || quality <= widest) continue;
        const fix = crossBearings(SITES[a.site].position, bearings[a.id], SITES[b.site].position, bearings[b.id]);
        if (fix) {
          location = fix;
          widest = quality;
        }
      }
    }
    const peakScore = Math.max(
      ...g.cams.flatMap((cam) => cam.frames.slice(0, step + 1).map(frameScore)),
    );
    return { id, raisedAtStep: g.at, cameraIds: g.cams.map((c) => c.id), bearings, location, peakScore, verdict: reviews[id] ?? null };
  });

  alerts.reverse();
  return { step, steps: t.steps, clock, cameras, alerts, needsReview: alerts.filter((a) => !a.verdict).length };
}
