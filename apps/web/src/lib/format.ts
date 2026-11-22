export type CameraState = "clear" | "suspect" | "fire";

export const STATE_LABEL: Record<CameraState, string> = {
  clear: "Clear",
  suspect: "Possible smoke",
  fire: "Smoke detected",
};

/** Tailwind classes for each camera state. */
export const STATE_TONE: Record<CameraState, { text: string; dot: string; ring: string }> = {
  clear: { text: "text-clear", dot: "bg-clear", ring: "ring-clear/40" },
  suspect: { text: "text-suspect", dot: "bg-suspect", ring: "ring-suspect/50" },
  fire: { text: "text-fire", dot: "bg-fire", ring: "ring-fire/60" },
};

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export const compass = (deg: number) => `${Math.round(deg).toString().padStart(3, "0")}°`;

export const coords = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(3)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(3)}° ${lon >= 0 ? "E" : "W"}`;

/** "2024-01-08T12-43-00" -> "12:43" */
export const takenAt = (taken: string) => taken.slice(11, 16).replace("-", ":");
