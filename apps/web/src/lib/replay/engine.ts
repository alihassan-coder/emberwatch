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

/*
  Alerts: a faithful port of apps/api/src/services/alerts.py (process_frame).
  The demo works without the API, so the browser runs the same rules itself;
  apps/web/src/data/demo/expected_alerts.json pins both sides to the same result.

  The replay shows each camera's photos in order, one step at a time, but
  alerts are decided in real time order, like the API: at step s, every photo
  shown so far is fed through the rules sorted by the time it was taken.
  That keeps "before" photos from other days out of the fire's 15-minute window.
*/

const RULE_WINDOW_MS = 15 * 60_000; // the K-of-N rule only counts photos this recent
const OPEN_WINDOW_MS = 30 * 60_000; // an alert stays open while a camera saw it this recently
const MIN_CROSS_ANGLE = 30;
const MAX_CROSS_ANGLE = 150;

/** "2024-01-08T12-03-11" -> ms. Local camera time; only differences matter. */
const timeOf = (taken: string) => {
  const [y, mo, d, h, mi, s] = taken.split(/[-T]/).map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s);
};

const angleBetween = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** Heading shifted by where the model's strongest tile sits across the photo (never a person's box). */
function bearingTo(cam: ManifestCamera, f: ManifestFrame): number {
  const tiles = f.tiles ?? [];
  if (!tiles.length) return ((cam.heading % 360) + 360) % 360;
  const width = Math.max(...tiles.map((t) => t.x + t.size));
  const best = tiles.reduce((a, b) => (b.p > a.p ? b : a));
  const offset = ((best.x + best.size / 2) / width - 0.5) * CAMERA_FOV;
  return (((cam.heading + offset) % 360) + 360) % 360;
}

type Member = { cam: ManifestCamera; bearing: number };
type AlertState = {
  id: string;
  raisedAtStep: number;
  raisedAt: number;
  lastSeen: number;
  peakScore: number;
  members: Member[];
  location: LatLon | null;
};

function samePlume(a: Member, b: Member): boolean {
  if (a.cam.site === b.cam.site) return true;
  const pa = SITES[a.cam.site]?.position, pb = SITES[b.cam.site]?.position;
  if (!pa || !pb) return false;
  const angle = angleBetween(a.bearing, b.bearing);
  if (angle < MIN_CROSS_ANGLE || angle > MAX_CROSS_ANGLE) return false;
  const fix = crossBearings(pa, a.bearing, pb, b.bearing);
  return !!fix && distanceKm(pa, fix) <= MAX_PLUME_KM && distanceKm(pb, fix) <= MAX_PLUME_KM;
}

/** Best crossing (closest to 90 degrees) of bearings from two different sites. */
function locate(members: Member[]): LatLon | null {
  let best: LatLon | null = null;
  let quality = -1;
  members.forEach((a, i) => {
    for (const b of members.slice(i + 1)) {
      if (a.cam.site === b.cam.site) continue;
      const pa = SITES[a.cam.site]?.position, pb = SITES[b.cam.site]?.position;
      if (!pa || !pb) continue;
      const angle = angleBetween(a.bearing, b.bearing);
      if (angle < MIN_CROSS_ANGLE || angle > MAX_CROSS_ANGLE) continue;
      const fix = crossBearings(pa, a.bearing, pb, b.bearing);
      const q = 90 - Math.abs(angle - 90);
      if (fix && q > quality) {
        best = fix;
        quality = q;
      }
    }
  });
  return best;
}

/** Run the alert rules over every photo shown up to `step`, in the order they were taken. */
function alertsUpTo(t: Timeline, step: number): AlertState[] {
  const shown = t.manifest.cameras.flatMap((cam) =>
    cam.frames.slice(0, step + 1).map((frame, index) => ({ cam, frame, index, at: timeOf(frame.taken) })),
  );
  shown.sort((a, b) => (a.frame.taken < b.frame.taken ? -1 : a.frame.taken > b.frame.taken ? 1 : 0)); // stable, like Python's sorted()

  const seen = new Map<string, { at: number; score: number }[]>();
  const alerts: AlertState[] = [];
  for (const { cam, frame, index, at } of shown) {
    const history = seen.get(cam.id) ?? [];
    history.push({ at, score: frameScore(frame) });
    seen.set(cam.id, history);

    const recent = history.filter((h) => h.at <= at && h.at >= at - RULE_WINDOW_MS).sort((a, b) => b.at - a.at).slice(0, RULE.n);
    if (recent.filter((h) => h.score >= t.threshold).length < RULE.k) continue;

    const me: Member = { cam, bearing: bearingTo(cam, frame) };
    const score = frameScore(frame);
    const open = alerts.filter((a) => a.lastSeen >= at - OPEN_WINDOW_MS).sort((a, b) => b.lastSeen - a.lastSeen);
    const home = open.find((a) => a.members.some((m) => m.cam.id === cam.id) || a.members.some((m) => samePlume(me, m)));
    if (home) {
      if (!home.members.some((m) => m.cam.id === cam.id)) {
        home.members.push(me);
        home.location = locate(home.members) ?? home.location;
      }
      home.peakScore = Math.max(home.peakScore, score);
      home.lastSeen = Math.max(home.lastSeen, at);
      continue;
    }
    if (score < t.threshold) continue; // a new alert only starts on a photo that itself shows smoke
    alerts.push({
      id: `A-${2611 + alerts.length}`, raisedAtStep: index, raisedAt: at, lastSeen: at,
      peakScore: Math.max(...recent.map((h) => h.score)), members: [me], location: null,
    });
  }
  return alerts;
}

const pad = (n: number) => n.toString().padStart(2, "0");

export function snapshotAt(t: Timeline, rawStep: number, reviews: Reviews): Snapshot {
  const step = Math.max(0, Math.min(t.steps - 1, rawStep));
  const [startH, startM] = t.manifest.window[0].split(":").map(Number);
  const minutes = startH * 60 + startM + step * 6;
  const clock = `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

  const states = alertsUpTo(t, step);
  const inAlert = new Set(states.flatMap((a) => a.members.map((m) => m.cam.id)));

  const cameras: CameraView[] = t.manifest.cameras.map((cam) => {
    const i = Math.min(step, cam.frames.length - 1);
    const frame = cam.frames[i];
    const score = frameScore(frame);
    const site = SITES[cam.site];
    return {
      id: cam.id,
      siteName: site?.name ?? cam.site,
      heading: cam.heading,
      position: site?.position ?? { lat: 43.75, lon: 7.1 },
      unseenSite: cam.split === "test",
      frame,
      frameIndex: i,
      score,
      history: cam.frames.slice(0, i + 1).map(frameScore),
      state: stateOf(score, t.threshold),
      alerting: inAlert.has(cam.id),
    };
  });

  const alerts: PlumeAlert[] = states.map((a) => ({
    id: a.id,
    raisedAtStep: a.raisedAtStep,
    cameraIds: a.members.map((m) => m.cam.id),
    bearings: Object.fromEntries(a.members.map((m) => [m.cam.id, m.bearing])),
    location: a.location,
    peakScore: a.peakScore,
    verdict: reviews[a.id] ?? null,
  }));
  alerts.reverse(); // newest first
  return { step, steps: t.steps, clock, cameras, alerts, needsReview: alerts.filter((a) => !a.verdict).length };
}
