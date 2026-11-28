import { describe, expect, it } from "vitest";
import { bearing, crossBearings, distanceKm, travel } from "@/lib/geo";

const A = { lat: 43.8, lon: 7.0 };

describe("geo", () => {
  it("bearing points the right way", () => {
    expect(bearing(A, { lat: 44, lon: 7 })).toBeCloseTo(0, 3);          // due north
    expect(bearing(A, { lat: 43.8, lon: 7.2 })).toBeCloseTo(90, 0);     // due east
  });

  it("travel and distance agree", () => {
    expect(distanceKm(A, travel(A, 45, 10))).toBeCloseTo(10, 1);
  });

  it("two bearings cross where both towers look", () => {
    const fire = { lat: 43.75, lon: 7.1 };
    const B = { lat: 43.65, lon: 7.0 };
    const fix = crossBearings(A, bearing(A, fire), B, bearing(B, fire))!;
    expect(distanceKm(fix, fire)).toBeLessThan(0.3);
  });

  it("parallel lines, or a crossing behind the camera, give no location", () => {
    expect(crossBearings(A, 90, { lat: 43.7, lon: 7.0 }, 90)).toBeNull();
    expect(crossBearings(A, 0, { lat: 43.7, lon: 7.1 }, 270)).toBeNull();
  });
});
