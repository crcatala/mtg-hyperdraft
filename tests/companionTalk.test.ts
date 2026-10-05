import { afterEach, describe, expect, it, vi } from "vitest";
import { BUBBLE_MS, bubblePop, say, useBubbles } from "../src/client/table/companionTalk";

describe("speech bubbles", () => {
  afterEach(() => {
    vi.useRealTimers();
    useBubbles.setState({ bubbles: {} });
  });

  it("one bubble per companion: a new line replaces the old, and it goes after BUBBLE_MS", () => {
    vi.useFakeTimers();
    say("p1", "Hello?");
    say("p2", "Hm.");
    const first = useBubbles.getState().bubbles.p1;
    vi.advanceTimersByTime(BUBBLE_MS - 500);
    say("p1", "Again?", "large");
    const second = useBubbles.getState().bubbles.p1;
    expect(second).toMatchObject({ text: "Again?", size: "large" });
    expect(second.id).not.toBe(first.id);
    // The first bubble's timer must not take the replacement down with it.
    vi.advanceTimersByTime(500);
    expect(useBubbles.getState().bubbles.p1?.text).toBe("Again?");
    expect(useBubbles.getState().bubbles.p2).toBeUndefined();
    vi.advanceTimersByTime(BUBBLE_MS);
    expect(useBubbles.getState().bubbles).toEqual({});
  });

  it("says nothing for a missing line", () => {
    say("p1", undefined);
    say("p1", "");
    expect(useBubbles.getState().bubbles).toEqual({});
  });

  it("pops in, holds, fades out by BUBBLE_MS; reduced motion only fades", () => {
    expect(bubblePop(0)).toEqual({ scale: 0, alpha: 0 });
    expect(Math.max(...[60, 100, 130, 160].map((t) => bubblePop(t).scale))).toBeGreaterThan(1); // a little overshoot
    expect(bubblePop(1000)).toEqual({ scale: 1, alpha: 1 });
    expect(bubblePop(BUBBLE_MS).alpha).toBe(0);
    expect(bubblePop(BUBBLE_MS + 500).alpha).toBe(0);
    for (const t of [0, 50, 1000, BUBBLE_MS - 100]) expect(bubblePop(t, true).scale).toBe(1);
    expect(bubblePop(1000, true).alpha).toBe(1);
  });
});
