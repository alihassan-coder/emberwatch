/*
  Contract: the browser replay raises the same alerts as the backend on the demo day.
  The backend side of this check is apps/api/tests/test_demo_contract.py; both
  read the same file, src/data/demo/expected_alerts.json.
*/
import { describe, expect, it } from "vitest";
import expected from "@/data/demo/expected_alerts.json";
import { DEMO_MANIFEST } from "@/lib/replay/demo";
import { buildTimeline, snapshotAt } from "@/lib/replay/engine";

const timeline = buildTimeline(DEMO_MANIFEST);
const last = timeline.steps - 1;

describe("demo day contract with the API", () => {
  const alerts = [...snapshotAt(timeline, last, {}).alerts].reverse(); // oldest first, like the API

  it("raises the same alerts, with the same cameras", () => {
    expect(alerts.map((a) => ({ code: a.id, cameras: a.cameraIds }))).toEqual(
      expected.map((e) => ({ code: e.code, cameras: e.cameras })),
    );
  });

  it("aims the same bearings and finds the same locations and peaks", () => {
    alerts.forEach((a, i) => {
      const e = expected[i];
      // The expected file stores bearings rounded to 0.1 degree.
      a.cameraIds.forEach((id, j) => expect(Math.abs(a.bearings[id] - e.bearings[j])).toBeLessThanOrEqual(0.06));
      if (e.location === null) expect(a.location).toBeNull();
      else {
        expect(a.location?.lat).toBeCloseTo(e.location[0], 2);
        expect(a.location?.lon).toBeCloseTo(e.location[1], 2);
      }
      expect(a.peakScore).toBeCloseTo(e.peak_score, 3);
    });
  });

  it("never renames an alert as the replay moves forward", () => {
    const finalCams = new Map(alerts.map((a) => [a.id, a.cameraIds[0]]));
    for (let s = 0; s <= last; s++) {
      for (const a of snapshotAt(timeline, s, {}).alerts) expect(finalCams.get(a.id)).toBe(a.cameraIds[0]);
    }
  });
});
