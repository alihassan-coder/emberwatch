import type { Manifest, ManifestCamera, ManifestFrame } from "@/lib/replay/manifest";

/** A frame with a smoke box in the middle of the picture (so the bearing is the camera heading). */
export const frame = (score: number, minute: number): ManifestFrame => ({
  file: `f-${minute}.jpg`,
  taken: `2024-01-08T12-${String(minute).padStart(2, "0")}-00`,
  phase: score >= 0.5 ? "smoke" : "clear",
  smoke: score >= 0.5,
  boxes: score >= 0.5 ? [[200, 460, 240, 500]] : [],
  score,
});

export const camera = (id: string, site: string, heading: number, scores: number[]): ManifestCamera => ({
  id, site, heading, split: "test", role: "smoke", frames: scores.map((s, i) => frame(s, i)),
});

/**
 * Two towers that see one plume near 43.74 N, 7.10 E:
 * Cabanelle looks south-south-east, Valbonne looks north-east.
 */
export const manifest = (cameras: ManifestCamera[]): Manifest => ({
  source: "test", day: "2024-01-08", window: ["12:00", "13:00"], frame_size: [960, 540],
  model: { name: "m", version: "v", threshold: 0.23 }, cameras,
});
