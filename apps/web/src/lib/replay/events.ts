/*
  The control room's event log: what happened, photo by photo, up to now.

  Built by comparing the engine's snapshot at each step with the one before,
  so it stays a pure function of (timeline, step, reviews) like the engine.
*/

import { snapshotAt, type Reviews, type Timeline } from "./engine";
import { coords, pct, takenAt } from "@/lib/format";

export type ReplayEvent = {
  key: string;
  step: number;
  time: string;          // real photo time of the camera involved, e.g. "12:03"
  kind: "smoke" | "alert" | "join" | "located" | "notify" | "clear";
  text: string;
  alertId?: string;
  cameraId?: string;
};

export function eventsUntil(t: Timeline, step: number, reviews: Reviews): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  let prev = snapshotAt(t, -1, reviews);
  prev = { ...prev, cameras: prev.cameras.map((c) => ({ ...c, state: "clear" as const })), alerts: [] };

  for (let s = 0; s <= step; s++) {
    const now = snapshotAt(t, s, reviews);
    const timeOf = (id: string) => takenAt(now.cameras.find((c) => c.id === id)?.frame.taken ?? "");

    for (const cam of now.cameras) {
      const before = prev.cameras.find((c) => c.id === cam.id);
      if (cam.state !== "clear" && before?.state === "clear") {
        const seen = `${cam.id} sees ${cam.state === "fire" ? "smoke" : "possible smoke"}, ${pct(cam.score)}`;
        // A camera that isn't (yet) alerting: say why nobody was woken up.
        const next = snapshotAt(t, s + 1, reviews).cameras.find((c) => c.id === cam.id);
        const lone = !cam.alerting && s < step && next?.state === "clear";  // only once the next photo has arrived
        events.push({ key: `smoke-${cam.id}-${s}`, step: s, time: timeOf(cam.id), kind: lone ? "clear" : "smoke", cameraId: cam.id,
          text: lone ? `${seen}. One photo is not enough: no alert` : seen });
      }
    }

    for (const alert of [...now.alerts].reverse()) {
      const before = prev.alerts.find((a) => a.id === alert.id);
      const lead = alert.cameraIds[0];
      if (!before) {
        events.push({ key: `alert-${alert.id}`, step: s, time: timeOf(lead), kind: "alert", alertId: alert.id, cameraId: lead,
          text: `Alert ${alert.id} raised: smoke in 2 of the last 3 photos from ${lead}` });
        events.push({ key: `notify-${alert.id}`, step: s, time: timeOf(lead), kind: "notify", alertId: alert.id,
          text: `Duty officer sent a text about ${alert.id}` });
      }
      for (const id of alert.cameraIds) {
        if (before && !before.cameraIds.includes(id)) {
          events.push({ key: `join-${alert.id}-${id}`, step: s, time: timeOf(id), kind: "join", alertId: alert.id, cameraId: id,
            text: `${id} sees the same plume and joins ${alert.id}` });
        }
      }
      if (alert.location && !before?.location) {
        events.push({ key: `loc-${alert.id}`, step: s, time: timeOf(alert.cameraIds[alert.cameraIds.length - 1]), kind: "located",
          alertId: alert.id, text: `${alert.id} located: bearings cross at ${coords(alert.location.lat, alert.location.lon)}` });
      }
    }
    prev = now;
  }
  return events.reverse(); // newest first
}
