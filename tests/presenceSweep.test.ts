import { describe, expect, it } from "vitest";
import { PRESENCE_SWEEP_MS, presenceSweepAt, QUIET_AFTER_MS } from "../src/shared/presence";

const now = 1_000_000_000;

describe("presence sweeps", () => {
  it("sweeps a minute from now while the room is in use", () => {
    expect(presenceSweepAt(null, now, 2, now - 5_000)).toBe(now + PRESENCE_SWEEP_MS);
  });

  it("keeps an alarm already due within the sweep window", () => {
    expect(presenceSweepAt(now + 20_000, now, 1, now)).toBe(now + 20_000);
    expect(presenceSweepAt(now + PRESENCE_SWEEP_MS + 1, now, 1, now)).toBe(now + PRESENCE_SWEEP_MS);
    expect(presenceSweepAt(now - 1, now, 1, now)).toBe(now + PRESENCE_SWEEP_MS);
  });

  it("doesn't sweep an empty room", () => {
    expect(presenceSweepAt(null, now, 0, now)).toBeNull();
  });

  it("stops sweeping once the room has been quiet long enough", () => {
    expect(presenceSweepAt(null, now, 1, now - QUIET_AFTER_MS + 1)).toBe(now + PRESENCE_SWEEP_MS);
    expect(presenceSweepAt(null, now, 1, now - QUIET_AFTER_MS)).toBeNull();
  });

  it("wakes a forgotten tab's room about ten times, then lets it sleep", () => {
    const lastActivity = now;
    let t = now;
    let wakes = 0;
    for (let next = presenceSweepAt(null, t, 1, lastActivity); next !== null; next = presenceSweepAt(null, t, 1, lastActivity)) {
      t = next;
      wakes++;
    }
    expect(wakes).toBe(QUIET_AFTER_MS / PRESENCE_SWEEP_MS);
  });
});
