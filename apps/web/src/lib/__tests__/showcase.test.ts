import { describe, expect, it } from "vitest";
import { ALERT_THRESHOLD } from "@/lib/replay/engine";
import { SCENARIOS, videoMoments } from "@/lib/showcase";

const moments = (id: string) => videoMoments(SCENARIOS.find((s) => s.id === id)!.video, ALERT_THRESHOLD);

// These pin the home page's promises ("Caught in about 2 minutes", "Missed") to the real scores.
describe("home page scenarios", () => {
  it("town: smoke first seen, alert about 2 minutes later", () => {
    const m = moments("town");
    expect(m.alertAt).toBeGreaterThan(m.firstSmoke);
    expect(m.detectMinutes).toBeGreaterThan(1);
    expect(m.detectMinutes).toBeLessThan(3);
  });

  it("ridge: caught in under a minute, and its smoke-like clear photo raises nothing", () => {
    const m = moments("ridge");
    expect(m.detectMinutes).toBeLessThan(1);
    expect(m.alertAt).toBeGreaterThanOrEqual(m.firstSmoke);
  });

  it("faint: the model misses it, which the page says honestly", () => {
    const m = moments("faint");
    expect(m.firstSmoke).toBeGreaterThanOrEqual(0);
    expect(m.alertAt).toBe(-1);
    expect(m.detectMinutes).toBeNull();
  });

  it("the earlier (lead-in) photos are never mixed with the fire itself", () => {
    for (const s of SCENARIOS) {
      const m = videoMoments(s.video, ALERT_THRESHOLD);
      if (m.alertAt >= 0) expect(s.video.frames[m.alertAt].phase).toBe("smoke");
    }
  });
});
