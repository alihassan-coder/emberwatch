// The one place the demo manifest is loaded. JSON imports lose tuple types,
// so the shape is checked here once and everything else gets a typed Manifest.

import raw from "@/data/demo/manifest.json";
import type { Manifest } from "./manifest";

function check(m: unknown): Manifest {
  const x = m as Manifest;
  if (!Array.isArray(x.window) || x.window.length !== 2 || !Array.isArray(x.cameras) || x.cameras.length === 0) {
    throw new Error("demo manifest.json is malformed: re-run ml/src/data/demo_frames.py");
  }
  return x;
}

export const DEMO_MANIFEST: Manifest = check(raw);

export const framesOf = (cameraId: string) => DEMO_MANIFEST.cameras.find((c) => c.id === cameraId)?.frames ?? [];
