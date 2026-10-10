import { describe, expect, it } from "vitest";
import { FloodControl, RATE_LIMITS } from "../src/shared/rateLimit";

describe("flood control across a room being evicted", () => {
  /** Spreads messages over several sockets so the per-socket burst limit is not what runs out first. */
  function spendWrites(f: FloodControl, count: number, now: number) {
    for (let i = 0; i < count; i++) f.check(`s${i % 8}`, `p${i % 8}`, true, now);
  }

  it("restores bucket levels, refilled for the time that passed", () => {
    const f = new FloodControl(0);
    spendWrites(f, RATE_LIMITS.roomWrites.capacity, 0);
    const snap = f.snapshot(0);
    expect(snap.writes).toBeLessThan(1);

    const woken = new FloodControl(5_000);
    woken.restore(snap, 5_000, new Set(["s0"]));
    // 5 s at 1/s: about 5 state changes fit, not a fresh 120.
    let ok = 0;
    for (let i = 0; i < 20; i++) if (woken.check(`s${i % 8}`, `p${i % 8}`, true, 5_000).verdict === "ok") ok++;
    expect(ok).toBe(5);
  });

  it("keeps a socket's long-term budget but forgets sockets that are gone", () => {
    const f = new FloodControl(0);
    for (let i = 0; i < 3000; i++) f.check("gone", "p1", false, i * 40);
    f.check("here", "p2", false, 0);
    const snap = f.snapshot(120_000);
    expect(Object.keys(snap.sustained).sort()).toEqual(["gone", "here"]);

    const woken = new FloodControl(120_000);
    woken.restore(snap, 120_000, new Set(["here"]));
    expect(woken.snapshot(120_000).sustained).toHaveProperty("here");
    expect(woken.snapshot(120_000).sustained).not.toHaveProperty("gone");
  });

  it("keeps a penalty until it ends", () => {
    const f = new FloodControl(0);
    for (let i = 0; i < RATE_LIMITS.socket.capacity + RATE_LIMITS.floodDrops + 1; i++) f.check("s1", "p1", false, 0);
    const snap = f.snapshot(1_000);

    const woken = new FloodControl(30_000);
    woken.restore(snap, 30_000, new Set());
    expect(woken.penalized("p1", 30_000)).toBe(true);
    expect(woken.penalized("p1", RATE_LIMITS.penaltyMs + 1)).toBe(false);
  });

  it("only asks to be saved when a bucket is nearly empty or someone is penalized", () => {
    const f = new FloodControl(0);
    expect(f.pressured(0)).toBe(false);
    spendWrites(f, Math.floor(RATE_LIMITS.roomWrites.capacity * 0.5), 0);
    expect(f.pressured(0)).toBe(false);
    spendWrites(f, Math.ceil(RATE_LIMITS.roomWrites.capacity * 0.5), 0);
    expect(f.pressured(0)).toBe(true);
  });
});
