// Showcase data written by ml/src/data/showcase.py (real Pyro-SDIS footage from
// camera sites the model never trained on, scored by the trained model).

import townRaw from "@/data/demo/scenarios/town.json";
import ridgeRaw from "@/data/demo/scenarios/ridge.json";
import faintRaw from "@/data/demo/scenarios/faint.json";
import galleryRaw from "@/data/demo/showcase/gallery.json";
import { RULE } from "@/lib/replay/engine";

export type Tile = { x: number; y: number; size: number; p: number };

export type VideoFrame = {
  i: number;
  taken: string;          // "2023-05-23T17-21-00"
  phase: "lead" | "smoke";
  smoke: boolean;         // a person drew a smoke box on this frame
  boxes: number[][];
  score: number;
  tiles: Tile[];
};

export type ShowcaseVideo = {
  camera: string;
  site: string;
  heading: number;
  fps: number;
  seconds_per_frame_real: number;
  frame_size: [number, number];
  frames: VideoFrame[];
};

export type GalleryItem = {
  file: string;
  camera: string;
  taken: string;
  score: number;
  tiles: Tile[];
  boxes: number[][];
  smoke_area_pct: number | null;
};

export type Gallery = Record<"ignored" | "caught" | "missed", GalleryItem[]>;

export const GALLERY = galleryRaw as unknown as Gallery;

/** A real piece of footage the home page can play, and what it is meant to show. */
export type Scenario = {
  id: "town" | "ridge" | "faint";
  title: string;
  /** One line under the title in the picker. */
  hint: string;
  /** What the visitor should watch for. */
  story: string;
  src: string;
  video: ShowcaseVideo;
};

export const SCENARIOS: Scenario[] = [
  {
    id: "town",
    title: "Smoke behind a town",
    hint: "Caught in about 2 minutes",
    story:
      "A tower camera looking out over a town. The view is clear, then smoke rises beyond the houses, the model spots it, and the alert goes out.",
    src: "/demo/scenarios/town.mp4",
    video: townRaw as unknown as ShowcaseVideo,
  },
  {
    id: "ridge",
    title: "Fire on a forest ridge",
    hint: "Caught in under a minute",
    story:
      "A camera watching wooded hills. One clear photo on another day looks a bit like haze (watch the score jump), but one photo is never enough. When the real smoke comes, it is flagged at once.",
    src: "/demo/scenarios/ridge.mp4",
    video: ridgeRaw as unknown as ShowcaseVideo,
  },
  {
    id: "faint",
    title: "Faint, far-away smoke",
    hint: "Missed: a known weak spot",
    story:
      "An honest failure. The smoke here is a thin wisp far away, and the model never gets sure enough to raise an alert. The dashed ring shows where a person marked the smoke. Small, distant plumes are what the next model version is being trained to catch.",
    src: "/demo/scenarios/faint.mp4",
    video: faintRaw as unknown as ShowcaseVideo,
  },
];

const parseTaken = (taken: string) => Date.parse(`${taken.slice(0, 10)}T${taken.slice(11).replaceAll("-", ":")}Z`);

/** Key moments of a video: when smoke is first visible, and when the alert rule fires. */
export function videoMoments(video: ShowcaseVideo, threshold: number) {
  const frames = video.frames;
  const firstSmoke = frames.findIndex((f) => f.smoke);
  let alertAt = -1;
  for (let i = 0; i < frames.length && alertAt < 0; i++) {
    // The lead-in frames come from other days, so the rule never mixes them
    // with frames of the fire itself: only consecutive frames count.
    const window = frames.slice(Math.max(0, i - RULE.n + 1), i + 1).filter((f) => f.phase === frames[i].phase);
    if (frames[i].score >= threshold && window.filter((f) => f.score >= threshold).length >= RULE.k) alertAt = i;
  }
  const detectMinutes =
    firstSmoke >= 0 && alertAt >= 0
      ? (parseTaken(frames[alertAt].taken) - parseTaken(frames[firstSmoke].taken)) / 60_000
      : null;
  return { firstSmoke, alertAt, detectMinutes };
}

export const clockOf = (taken: string) => taken.slice(11, 16).replace("-", ":");
