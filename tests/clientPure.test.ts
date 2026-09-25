import { describe, expect, it } from "vitest";
import { handLayout, MAX_ARC_PX, MAX_EDGE_ROT_DEG } from "../src/client/table/handLayout";
import { relativeTime } from "../src/client/relativeTime";

describe("hand layout", () => {
  it("keeps a normal hand at full size with the classic fan", () => {
    const l = handLayout(7, 900);
    expect(l.width).toBe(150);
    expect(l.spread).toBeCloseTo(108);
    expect(l.rot(0)).toBeCloseTo(-6.6);
    expect(l.rot(3)).toBe(0);
    expect(l.arc(3)).toBe(0);
  });

  it("fits any hand size inside the available width, with bounded tilt and sink", () => {
    for (const avail of [420, 580, 1000]) {
      for (let n = 1; n <= 60; n++) {
        const l = handLayout(n, avail);
        expect(l.fanWidth).toBeLessThanOrEqual(Math.max(avail, l.width) + 1e-9);
        expect(Math.abs(l.rot(0))).toBeLessThanOrEqual(MAX_EDGE_ROT_DEG + 1e-9);
        expect(Math.abs(l.rot(n - 1))).toBeLessThanOrEqual(MAX_EDGE_ROT_DEG + 1e-9);
        expect(l.arc(0)).toBeLessThanOrEqual(MAX_ARC_PX + 1e-9);
        expect(l.arc(n - 1)).toBeLessThanOrEqual(MAX_ARC_PX + 1e-9);
      }
    }
  });

  it("shrinks cards before strips get too thin to hover", () => {
    const l = handLayout(25, 580);
    expect(l.spread).toBeGreaterThanOrEqual(16);
    expect(l.width).toBeGreaterThanOrEqual(70);
  });

  it("handles an empty hand", () => {
    expect(handLayout(0, 600).fanWidth).toBe(0);
  });
});

describe("relative time", () => {
  it("formats log ages", () => {
    expect(relativeTime(-500)).toBe("Just now");
    expect(relativeTime(59_000)).toBe("Just now");
    expect(relativeTime(60_000)).toBe("1 minute ago");
    expect(relativeTime(2 * 60_000 + 30_000)).toBe("2 minutes ago");
    expect(relativeTime(60 * 60_000)).toBe("1 hour ago");
    expect(relativeTime(5 * 60 * 60_000)).toBe("5 hours ago");
    expect(relativeTime(49 * 60 * 60_000)).toBe("2 days ago");
  });
});
