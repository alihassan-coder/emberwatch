// Showcase data written by ml/src/data/showcase.py (real Pyro-SDIS footage from
// camera sites the model never trained on, scored by the trained model).

import videoRaw from "@/data/demo/showcase/video.json";
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

export const VIDEO = videoRaw as unknown as ShowcaseVideo;
export const GALLERY = galleryRaw as unknown as Gallery;

/** Key moments of the video: when smoke is first visible, and when the alert rule fires. */
export function videoMoments(threshold: number) {
  const frames = VIDEO.frames;
  const firstSmoke = frames.findIndex((f) => f.smoke);
  let alertAt = -1;
  for (let i = 0; i < frames.length && alertAt < 0; i++) {
    const window = frames.slice(Math.max(0, i - RULE.n + 1), i + 1);
    if (window.filter((f) => f.score >= threshold).length >= RULE.k) alertAt = i;
  }
  const realMinutes = (from: number, to: number) => ((to - from) * VIDEO.seconds_per_frame_real) / 60;
  return {
    firstSmoke,
    alertAt,
    detectMinutes: firstSmoke >= 0 && alertAt >= 0 ? realMinutes(firstSmoke, alertAt) : null,
  };
}

export const clockOf = (taken: string) => taken.slice(11, 16).replace("-", ":");
