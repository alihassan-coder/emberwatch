import { describe, expect, it } from "vitest";
import { bearing } from "@/lib/geo";
import { SITES, buildTimeline } from "@/lib/replay/engine";
import { eventsUntil } from "@/lib/replay/events";
import { camera, manifest } from "./fixtures";

const PLUME = { lat: 43.74, lon: 7.1 };

describe("event log", () => {
  const t = buildTimeline(manifest([
    camera("cab", "cabanelle", bearing(SITES.cabanelle.position, PLUME), [0.1, 0.9, 0.9, 0.9]),
    camera("val", "valbonne", bearing(SITES.valbonne.position, PLUME), [0.1, 0.1, 0.9, 0.9]),
    camera("fer", "ferion", 90, [0.1, 0.1, 0.7, 0.1]),
  ]));

  it("tells the story in order: smoke, alert, text to the duty officer, a second tower, a location", () => {
    const oldestFirst = eventsUntil(t, 3, {}).reverse().map((e) => `${e.kind}:${e.cameraId ?? e.alertId}`);
    expect(oldestFirst).toEqual([
      "smoke:cab",                          // photo 2: first smoky photo, not an alert yet
      "smoke:val", "clear:fer",             // photo 3: val starts seeing it; fer's lone photo (explained later)
      "alert:cab", "notify:A-2611",         // photo 3: cab's second smoky photo raises the alert
      "join:val", "located:A-2611",         // photo 4: val joins, bearings cross
    ]);
  });

  it("explains a lone smoky photo only once the next photo shows it was a one-off", () => {
    const atTwo = eventsUntil(t, 2, {}).find((e) => e.cameraId === "fer");
    expect(atTwo?.text).not.toMatch(/not enough/);
    const atThree = eventsUntil(t, 3, {}).find((e) => e.cameraId === "fer");
    expect(atThree?.text).toMatch(/One photo is not enough: no alert/);
  });

  it("is empty before anything happens", () => {
    expect(eventsUntil(t, 0, {})).toEqual([]);
  });
});
