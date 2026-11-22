import type { CameraState } from "./types";

export const STATE_LABEL: Record<CameraState, string> = {
  clear: "Clear",
  suspect: "Possible smoke",
  fire: "Smoke detected",
};

/** Tailwind text/background classes for each camera state. */
export const STATE_TONE: Record<CameraState, { text: string; dot: string; ring: string }> = {
  clear: { text: "text-clear", dot: "bg-clear", ring: "ring-clear/40" },
  suspect: { text: "text-suspect", dot: "bg-suspect", ring: "ring-suspect/50" },
  fire: { text: "text-fire", dot: "bg-fire", ring: "ring-fire/60" },
};

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export function ago(minutes: number) {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min ago` : `${h} h ago`;
}

export const compass = (deg: number) => `${Math.round(deg).toString().padStart(3, "0")}°`;

export const coords = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(3)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(3)}° ${lon >= 0 ? "E" : "W"}`;
