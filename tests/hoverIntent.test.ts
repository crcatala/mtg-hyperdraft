import { describe, expect, it } from "vitest";
import { bridgeZone, convexContains, convexHull, inBridge, movedBeyond, rectContains, type Point, type Rect } from "../src/client/hoverIntent";

const rect = (left: number, top: number, w: number, h: number): Rect => ({ left, top, right: left + w, bottom: top + h });

describe("convex hull", () => {
  it("drops interior and collinear points", () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 },
      { x: 5, y: 0 },
    ];
    expect(convexHull(pts)).toHaveLength(4);
  });

  it("contains its edges and interior but not points beyond", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ]);
    expect(convexContains(hull, { x: 2, y: 2 })).toBe(true);
    expect(convexContains(hull, { x: 5, y: 5 })).toBe(true);
    expect(convexContains(hull, { x: 6, y: 6 })).toBe(false);
    expect(convexContains(hull, { x: -1, y: 0 })).toBe(false);
  });

  it("handles degenerate inputs", () => {
    expect(convexHull([])).toEqual([]);
    expect(convexContains([], { x: 0, y: 0 })).toBe(false);
    expect(convexContains(convexHull([{ x: 1, y: 1 }]), { x: 1, y: 1 })).toBe(true);
  });
});

describe("bridge to a popover", () => {
  // A chip mid-panel at x≈100, the popover across the panel at x 300–600, level with the chip.
  const origin = { x: 140, y: 200 };
  const pop = rect(300, 188, 300, 200);

  it("covers the straight path and anywhere inside the popover", () => {
    for (let x = 145; x <= 300; x += 5) expect(inBridge({ x, y: 200 }, origin, pop)).toBe(true);
    expect(inBridge({ x: 450, y: 300 }, origin, pop)).toBe(true);
  });

  it("covers diagonal paths to the popover's far corners", () => {
    expect(inBridge({ x: 220, y: 240 }, origin, pop)).toBe(true);
    expect(inBridge({ x: 220, y: 330 }, origin, pop)).toBe(false); // steeper than the wedge to the bottom-left corner
    expect(inBridge({ x: 280, y: 330 }, origin, pop)).toBe(true);
  });

  it("closes for pointers heading elsewhere", () => {
    expect(inBridge({ x: 60, y: 200 }, origin, pop)).toBe(false); // back the way it came
    expect(inBridge({ x: 140, y: 120 }, origin, pop)).toBe(false); // straight up
    expect(inBridge({ x: 200, y: 100 }, origin, pop)).toBe(false);
    expect(inBridge({ x: 620, y: 200 }, origin, pop)).toBe(false); // past the popover
  });

  it("forgives a pointer that leaves a few pixels past the chip, and grazing the popover edge", () => {
    expect(inBridge({ x: 136, y: 195 }, origin, pop)).toBe(true);
    expect(inBridge({ x: 296, y: 184 }, origin, pop)).toBe(true);
    expect(inBridge({ x: 296, y: 170 }, origin, pop)).toBe(false);
  });

  it("works whichever side the popover is on", () => {
    const left = rect(-260, 188, 300, 200);
    const from = { x: 140, y: 200 };
    expect(inBridge({ x: 60, y: 200 }, from, left)).toBe(true);
    expect(inBridge({ x: 200, y: 200 }, from, left)).toBe(false);
    const below = rect(100, 260, 300, 150);
    expect(inBridge({ x: 150, y: 235 }, from, below)).toBe(true);
    expect(inBridge({ x: 150, y: 150 }, from, below)).toBe(false);
  });

  it("is a hull around origin and popover, and follows the popover as it grows", () => {
    const zone = bridgeZone(origin, pop);
    expect(zone.length).toBeGreaterThanOrEqual(3);
    const taller = rect(300, 188, 300, 500);
    expect(inBridge({ x: 250, y: 500 }, origin, pop)).toBe(false);
    expect(inBridge({ x: 250, y: 500 }, origin, taller)).toBe(true);
  });

  it("respects custom padding", () => {
    expect(inBridge({ x: 290, y: 180 }, origin, pop, { pad: 0, originPad: 0 })).toBe(false);
    expect(inBridge({ x: 290, y: 180 }, origin, pop, { pad: 20 })).toBe(true);
  });
});

describe("rect and rest helpers", () => {
  it("rectContains includes the edges", () => {
    const r = rect(10, 10, 20, 20);
    expect(rectContains(r, { x: 10, y: 30 })).toBe(true);
    expect(rectContains(r, { x: 31, y: 20 })).toBe(false);
  });

  it("movedBeyond compares straight-line distance", () => {
    expect(movedBeyond({ x: 0, y: 0 }, { x: 3, y: 3 }, 4)).toBe(true); // 4.24
    expect(movedBeyond({ x: 0, y: 0 }, { x: 2, y: 2 }, 4)).toBe(false);
  });
});
