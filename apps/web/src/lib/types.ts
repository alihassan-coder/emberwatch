import type { LatLon } from "./geo";

/** What a camera currently shows, by the model's latest frame score. */
export type CameraState = "clear" | "suspect" | "fire";

export type Camera = {
  id: string;            // HPWREN-style camera id, e.g. "om-n"
  station: string;       // site the camera is mounted on
  name: string;          // what operators call it
  position: LatLon;
  azimuth: number;       // compass direction the camera faces
  fov: number;           // horizontal field of view, degrees
  state: CameraState;
  score: number;         // latest frame smoke score, 0-1
  scoreHistory: number[]; // one score per minute, oldest first
  frameAgeSec: number;   // how old the latest frame is
  scene: number;         // seed for the stand-in landscape drawing
  plume?: { x: number; y: number; size: number }; // where smoke appears in the frame, 0-1 coords
};

export type ReviewVerdict = "fire" | "not_fire";

export type AlertStatus = "needs_review" | "confirmed" | "dismissed";

export type Alert = {
  id: string;
  cameraIds: string[];          // every camera that sees this plume
  bearings: Record<string, number>; // camera id -> bearing to the plume
  firstAlertMinAgo: number;
  peakScore: number;
  status: AlertStatus;
  location?: LatLon;            // where bearings cross, when 2+ cameras see it
  timeline: { minute: number; score: number }[]; // minutes relative to the first alert
  dismissReason?: string;
};
