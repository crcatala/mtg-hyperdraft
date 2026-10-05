import { describe, expect, it } from "vitest";
import { clearLadder, IDLE_RESET_MS, newLadder, nextStep, observePoke, POKE_THROTTLE_MS, SULK_MS, tapLadder } from "../src/client/table/pokeLadder";
import { POKE_STEPS } from "../src/shared/companionKit";

/** Taps `target` every `gap` ms from `t0`, `n` times; the steps shown (null = ignored). */
function taps(ladder = newLadder(), target = "p1", n = 1, gap = 400, t0 = 1000) {
  return Array.from({ length: n }, (_, i) => tapLadder(ladder, target, t0 + i * gap));
}

describe("poke ladder", () => {
  it("has easy-to-tune constants in sane ranges", () => {
    expect(IDLE_RESET_MS).toBe(5000);
    expect(SULK_MS).toBeGreaterThanOrEqual(3000);
    expect(SULK_MS).toBeLessThanOrEqual(6000);
    expect(POKE_THROTTLE_MS).toBe(300);
    expect(POKE_STEPS).toBe(7);
  });

  it("climbs one step per tap, curious to the finale", () => {
    expect(taps(newLadder(), "p1", 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("sulks after the finale (taps ignored), then starts over", () => {
    const l = newLadder();
    const steps = taps(l, "p1", 7, 400, 0); // the finale lands at 2400
    expect(steps[6]).toBe(6);
    expect(tapLadder(l, "p1", 2400 + 500)).toBeNull();
    expect(tapLadder(l, "p1", 2400 + SULK_MS - 1)).toBeNull();
    expect(nextStep(l, "p1", 2400 + SULK_MS - 1)).toBeNull();
    expect(tapLadder(l, "p1", 2400 + SULK_MS)).toBe(0);
    expect(tapLadder(l, "p1", 2400 + SULK_MS + 400)).toBe(1);
  });

  it("starts over after being left alone for more than IDLE_RESET_MS", () => {
    const l = newLadder();
    taps(l, "p1", 3, 400, 0); // steps 0, 1, 2; last at 800
    expect(tapLadder(l, "p1", 800 + IDLE_RESET_MS)).toBe(3); // exactly at the limit: still climbing
    expect(tapLadder(l, "p1", 800 + IDLE_RESET_MS * 2 + 1)).toBe(0);
  });

  it("ignores taps closer together than POKE_THROTTLE_MS, across companions", () => {
    const l = newLadder();
    expect(tapLadder(l, "p1", 1000)).toBe(0);
    expect(tapLadder(l, "p1", 1000 + POKE_THROTTLE_MS - 1)).toBeNull();
    expect(tapLadder(l, "p2", 1000 + POKE_THROTTLE_MS - 1)).toBeNull();
    // An ignored tap doesn't count: the next one only needs to clear the last accepted tap.
    expect(tapLadder(l, "p1", 1000 + POKE_THROTTLE_MS)).toBe(1);
    expect(tapLadder(l, "p2", 1000 + POKE_THROTTLE_MS * 2)).toBe(0);
  });

  it("keeps a ladder per companion", () => {
    const l = newLadder();
    expect(tapLadder(l, "p1", 0)).toBe(0);
    expect(tapLadder(l, "p1", 400)).toBe(1);
    expect(tapLadder(l, "p2", 800)).toBe(0);
    expect(tapLadder(l, "p1", 1200)).toBe(2);
  });

  it("follows other players' pokes, including into the sulk", () => {
    const l = newLadder();
    observePoke(l, "p1", 3, 1000);
    expect(tapLadder(l, "p1", 1100)).toBe(4); // someone else's poke doesn't throttle this viewer
    observePoke(l, "p1", 6, 2000);
    expect(tapLadder(l, "p1", 2500)).toBeNull();
    expect(tapLadder(l, "p1", 2000 + SULK_MS)).toBe(0);
    // Out-of-range steps are clamped (the server rejects them anyway).
    observePoke(l, "p2", 99, 0);
    expect(nextStep(l, "p2", 100)).toBeNull();
  });

  it("drops someone else's poke that arrives while the companion sulks (it was sent before they saw the finale)", () => {
    const l = newLadder();
    taps(l, "p1", 7, 400, 0); // this viewer's finale at 2400
    expect(observePoke(l, "p1", 3, 2500)).toBe(false);
    // The sulk still holds, and still ends on time.
    expect(tapLadder(l, "p1", 2900)).toBeNull();
    expect(nextStep(l, "p1", 2400 + SULK_MS - 1)).toBeNull();
    expect(tapLadder(l, "p1", 2400 + SULK_MS)).toBe(0);
    // After the sulk, other players' pokes count again.
    expect(observePoke(l, "p1", 1, 2400 + SULK_MS + 400)).toBe(true);
  });

  it("never moves back down for a late, lower step", () => {
    const l = newLadder();
    taps(l, "p1", 4, 400, 0); // steps 0..3, last at 1200
    expect(observePoke(l, "p1", 1, 1300)).toBe(true); // still shown (it's what its sender saw)...
    expect(tapLadder(l, "p1", 1600)).toBe(4); // ...but the ladder carries on from 3
    // A higher step does move it up, and a remote finale starts the sulk here too.
    expect(observePoke(l, "p1", 6, 1700)).toBe(true);
    expect(tapLadder(l, "p1", 2100)).toBeNull();
    // Once this viewer's ladder has gone idle, a remote step is taken as it is.
    const m = newLadder();
    taps(m, "p1", 4, 400, 0);
    observePoke(m, "p1", 1, 1200 + IDLE_RESET_MS + 1);
    expect(tapLadder(m, "p1", 1200 + IDLE_RESET_MS + 400)).toBe(2);
  });

  it("forgets everything when cleared (a new room reuses player ids)", () => {
    const l = newLadder();
    taps(l, "p1", 7, 400, 0);
    clearLadder(l);
    expect(tapLadder(l, "p1", 2500)).toBe(0); // no sulk, no throttle carried over
  });
});
