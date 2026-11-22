// Shape of public/demo/manifest.json, written by ml/src/data/demo_frames.py.

export type ManifestFrame = {
  file: string;            // relative to /demo/
  taken: string;           // "2024-01-08T12-43-00"
  phase: "before" | "smoke" | "clear";
  smoke: boolean;          // a person drew a smoke box on this frame
  boxes: number[][];       // [ymin, xmin, ymax, xmax] in frame pixels
  score?: number;          // the model's frame score (highest tile)
  tiles?: { x: number; y: number; size: number; p: number }[];
};

export type ManifestCamera = {
  id: string;              // "ferion-142": site + compass heading
  site: string;
  heading: number;
  split: "train" | "val" | "test";
  role: "smoke" | "clear";
  frames: ManifestFrame[];
};

export type Manifest = {
  source: string;
  day: string;
  window: [string, string];
  frame_size: [number, number];
  model: { name: string; version: string; threshold: number } | null;
  cameras: ManifestCamera[];
};
