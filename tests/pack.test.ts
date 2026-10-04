import { describe, expect, it } from "vitest";
import { HALF_H, HALF_W, PACK_T, TEAR_Y, buildPeelPath, halfThickness, peelOffset, sideProfile, tearEdgeY } from "../src/client/pack/packShape";
import { COMMIT_AT, MAX_RATE, autoStep, dirFromGrab, progressAt, soundSpeed, stepFront } from "../src/client/pack/tearGesture";
import { wants3dPack } from "../src/client/pack/support";
import { analyze, jitter, normalizeGain, pickTake, SILENCE } from "../src/client/sfxMath";
import { RARITY_RANK, revealSchedule } from "../src/client/revealSchedule";
import type { Rarity } from "../src/shared/types";

describe("pack shape", () => {
  it("is fullest in the middle of the body and never thicker than the pillow allows", () => {
    expect(halfThickness(0, 0)).toBeGreaterThan(PACK_T * 0.95);
    for (let x = -HALF_W; x <= HALF_W; x += 0.1) {
      for (let y = -HALF_H; y <= HALF_H; y += 0.1) {
        const t = halfThickness(x, y);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(PACK_T * 1.11);
      }
    }
  });

  it("pinches shut along the sides and flat through the crimped seals", () => {
    expect(sideProfile(HALF_W)).toBeCloseTo(0);
    expect(halfThickness(HALF_W, 0)).toBeCloseTo(0);
    expect(halfThickness(0, HALF_H)).toBe(0);
    expect(halfThickness(0, -HALF_H + 0.2)).toBe(0);
  });

  it("tears along a ragged line that stays just under the top crimp", () => {
    const ys = Array.from({ length: 200 }, (_, i) => tearEdgeY(-HALF_W + (i / 199) * 2 * HALF_W));
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.01); // actually ragged
    for (const y of ys) expect(Math.abs(y - TEAR_Y)).toBeLessThan(0.06);
    expect(tearEdgeY(0.37)).toBe(tearEdgeY(0.37)); // the strip and the body agree on it
  });

  it("leaves the strip alone ahead of the tear front and curls it smoothly behind", () => {
    const path = buildPeelPath(2, 1.2);
    expect(peelOffset(path, 0, 0.1)).toEqual({ da: 0, dy: 0, dz: 0 });
    expect(peelOffset(path, -0.5, 0.1)).toEqual({ da: 0, dy: 0, dz: 0 });
    // Continuous at the front: a hair behind it barely moves.
    const near = peelOffset(path, 0.01, 0);
    expect(Math.hypot(near.da, near.dy, near.dz)).toBeLessThan(0.02);
    // The further back, the further it curls out toward the viewer, and it ends up past vertical.
    let lastZ = 0;
    for (const b of [0.2, 0.5, 0.9, 1.4, 2]) {
      const z = peelOffset(path, b, 0).dz;
      expect(z).toBeGreaterThan(lastZ);
      lastZ = z;
    }
    expect(path.theta[path.theta.length - 1]).toBeCloseTo(2);
  });
});

describe("which pack is shown", () => {
  it("uses the 3D pack only with WebGL and without reduced motion", () => {
    expect(wants3dPack(true, false)).toBe(true);
    // Reduced motion gets the CSS pack, whose opening (pointer or keyboard) skips to the revealed cards.
    expect(wants3dPack(true, true)).toBe(false);
    expect(wants3dPack(false, false)).toBe(false);
    expect(wants3dPack(false, true)).toBe(false);
  });
});

describe("tearing gesture", () => {
  it("measures progress along the top from the side the tear starts at", () => {
    expect(progressAt(-HALF_W, 1)).toBe(0);
    expect(progressAt(0, 1)).toBeCloseTo(0.5);
    expect(progressAt(HALF_W, 1)).toBe(1);
    expect(progressAt(HALF_W, -1)).toBe(0);
    expect(progressAt(-HALF_W, -1)).toBe(1);
    expect(progressAt(99, 1)).toBe(1);
  });

  it("tears away from the nearer side edge, and lets the drag decide near the middle", () => {
    expect(dirFromGrab(-1)).toBe(1);
    expect(dirFromGrab(1)).toBe(-1);
    expect(dirFromGrab(0.1)).toBe(0);
  });

  it("follows the pointer but never backwards and never faster than foil rips", () => {
    expect(stepFront(0.5, 0.2, 0.016)).toBe(0.5);
    expect(stepFront(0.5, 0.5, 0.016)).toBe(0.5);
    // A flick from one corner to the other still takes a moment.
    let p = 0;
    let frames = 0;
    while (p < 1 && frames < 1000) {
      p = stepFront(p, 1, 1 / 60);
      frames++;
    }
    expect(p).toBe(1);
    expect(frames / 60).toBeGreaterThan(1 / MAX_RATE - 0.01);
    expect(frames / 60).toBeLessThan(1);
    // And it never overshoots its target.
    expect(stepFront(0.9, 0.91, 1)).toBe(0.91);
  });

  it("finishes a click-to-open tear on its own, slow to bite then fast", () => {
    let p = 0;
    let t = 0;
    const early = autoStep(0, 1 / 60) - 0;
    while (p < COMMIT_AT && t < 5) {
      p = autoStep(p, 1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeGreaterThan(0.3);
    expect(t).toBeLessThan(0.9);
    expect(autoStep(0.8, 1 / 60) - 0.8).toBeGreaterThan(early * 3);
  });

  it("maps rip speed to a 0…1 sound level", () => {
    expect(soundSpeed(0)).toBe(0);
    expect(soundSpeed(1.2)).toBeCloseTo(0.5);
    expect(soundSpeed(50)).toBe(1);
  });
});

describe("sound sample analysis", () => {
  it("finds where a sample really starts and how loud it is once it does", () => {
    const data = new Float32Array(1000);
    for (let i = 300; i < 700; i++) data[i] = 0.5 * (i % 2 ? 1 : -1);
    data[10] = SILENCE / 2; // room tone doesn't count
    const a = analyze(data);
    expect(a.start).toBe(300);
    expect(a.peak).toBeCloseTo(0.5);
    expect(a.rms).toBeCloseTo(0.5, 1);
  });

  it("normalizes quiet sounds up and lets loud clicks stop at the ceiling", () => {
    expect(normalizeGain({ start: 0, peak: 0.2, rms: 0.06 }, 0.12, 0.95)).toBeCloseTo(2);
    // A click: high peak, low RMS. The RMS target would clip it, so the ceiling wins.
    expect(normalizeGain({ start: 0, peak: 0.9, rms: 0.02 }, 0.12, 0.95)).toBeCloseTo(0.95 / 0.9);
    expect(normalizeGain({ start: 0, peak: 0, rms: 0 })).toBe(1);
  });

  it("never plays the same take twice in a row, and uses them all", () => {
    let last = -1;
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const t = pickTake(4, last);
      expect(t).not.toBe(last);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThan(4);
      seen.add(t);
      last = t;
    }
    expect(seen.size).toBe(4);
    expect(pickTake(1, 0)).toBe(0);
  });

  it("varies pitch a little around the base rate", () => {
    expect(jitter(1, 0.05, () => 0)).toBeCloseTo(0.95);
    expect(jitter(1, 0.05, () => 1)).toBeCloseTo(1.05);
    expect(jitter(2, 0.05, () => 0.5)).toBeCloseTo(2);
  });
});

describe("reveal chimes", () => {
  it("marks only the cards rarer than the pack's typical card as notable", () => {
    const ranks = (rs: Rarity[]) => rs.map((r) => RARITY_RANK[r]);
    const retail = revealSchedule(ranks([...Array<Rarity>(10).fill("common"), ...Array<Rarity>(3).fill("uncommon"), "rare", "mythic"]));
    // The three uncommons get a chime; the rare and mythic are highlights with their own fanfare.
    expect(retail.reveals.filter((r) => r.notable).map((r) => r.k)).toEqual([10, 11, 12]);
    expect(retail.reveals.filter((r) => r.highlight && r.notable)).toHaveLength(0);
    // A pack of all one rarity has nothing standing out, so no chime spam.
    const flat = revealSchedule(ranks(Array<Rarity>(15).fill("rare")));
    expect(flat.reveals.some((r) => r.notable || r.highlight)).toBe(false);
  });
});
