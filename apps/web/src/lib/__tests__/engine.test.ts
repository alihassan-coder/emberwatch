import { describe, expect, it } from "vitest";
import { bearing } from "@/lib/geo";
import { SITES, buildTimeline, snapshotAt } from "@/lib/replay/engine";
import { camera, manifest } from "./fixtures";

const PLUME = { lat: 43.74, lon: 7.1 };
const fromCabanelle = bearing(SITES.cabanelle.position, PLUME);
const fromValbonne = bearing(SITES.valbonne.position, PLUME);

describe("alert rule: 2 of the last 3 photos", () => {
  it("one smoky photo is not enough", () => {
    const t = buildTimeline(manifest([camera("cab", "cabanelle", 160, [0.1, 0.9, 0.1, 0.1])]));
    for (let s = 0; s < 4; s++) expect(snapshotAt(t, s, {}).alerts).toHaveLength(0);
  });

  it("raises an alert on the second smoky photo within three", () => {
    const t = buildTimeline(manifest([camera("cab", "cabanelle", 160, [0.9, 0.1, 0.9, 0.1])]));
    expect(snapshotAt(t, 1, {}).alerts).toHaveLength(0);
    const at2 = snapshotAt(t, 2, {});
    expect(at2.alerts).toHaveLength(1);
    expect(at2.alerts[0]).toMatchObject({ raisedAtStep: 2, cameraIds: ["cab"], location: null });
  });
});

describe("plumes", () => {
  it("two towers whose bearings cross join one alert with a location", () => {
    const t = buildTimeline(manifest([
      camera("cab", "cabanelle", fromCabanelle, [0.9, 0.9, 0.9]),
      camera("val", "valbonne", fromValbonne, [0.1, 0.9, 0.9]),
    ]));
    const { alerts } = snapshotAt(t, 2, {});
    expect(alerts).toHaveLength(1);
    expect(alerts[0].cameraIds).toEqual(["cab", "val"]);
    expect(alerts[0].location?.lat).toBeCloseTo(PLUME.lat, 1);
    expect(alerts[0].location?.lon).toBeCloseTo(PLUME.lon, 1);
  });

  it("towers looking away from each other's smoke get separate alerts", () => {
    const t = buildTimeline(manifest([
      camera("cab", "cabanelle", 0, [0.9, 0.9]),       // looking north, away from Valbonne's view
      camera("val", "valbonne", 180, [0.9, 0.9]),      // looking south
    ]));
    expect(snapshotAt(t, 1, {}).alerts).toHaveLength(2);
  });
});

describe("replay", () => {
  const t = buildTimeline(manifest([camera("cab", "cabanelle", 160, [0.1, 0.9, 0.9])]));

  it("is deterministic: the same step always looks the same", () => {
    expect(snapshotAt(t, 2, {})).toEqual(snapshotAt(t, 2, {}));
  });

  it("clamps steps to the replay length", () => {
    expect(snapshotAt(t, 99, {}).step).toBe(2);
    expect(snapshotAt(t, -5, {}).step).toBe(0);
  });

  it("a reviewed alert no longer needs review", () => {
    const open = snapshotAt(t, 2, {});
    expect(open.needsReview).toBe(1);
    const id = open.alerts[0].id;
    const done = snapshotAt(t, 2, { [id]: { status: "dismissed", reason: "Fog" } });
    expect(done.needsReview).toBe(0);
    expect(done.alerts[0].verdict).toEqual({ status: "dismissed", reason: "Fog" });
  });
});
