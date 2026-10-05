import { afterEach, describe, expect, it, vi } from "vitest";
import { BUBBLE_MARGIN, BUBBLE_MS, bubblePop, LARGE_BUBBLE_MS, placeBubble, say, useBubbles } from "../src/client/table/companionTalk";

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
    // The replacement is large (an emote): it stays up LARGE_BUBBLE_MS (500 ms of it have gone by).
    vi.advanceTimersByTime(LARGE_BUBBLE_MS - 500 - 1);
    expect(useBubbles.getState().bubbles.p1?.text).toBe("Again?");
    vi.advanceTimersByTime(1);
    expect(useBubbles.getState().bubbles).toEqual({});
  });

  it("says nothing for a missing line", () => {
    say("p1", undefined);
    say("p1", "");
    expect(useBubbles.getState().bubbles).toEqual({});
  });

  it("pops in, holds, fades out by BUBBLE_MS; reduced motion only fades", () => {
    expect(bubblePop(0)).toEqual({ scale: 0, alpha: 0, rot: 0 });
    expect(Math.max(...[60, 100, 130, 160].map((t) => bubblePop(t).scale))).toBeGreaterThan(1); // a little overshoot
    expect(bubblePop(1000)).toEqual({ scale: 1, alpha: 1, rot: 0 });
    expect(bubblePop(BUBBLE_MS).alpha).toBe(0);
    expect(bubblePop(BUBBLE_MS + 500).alpha).toBe(0);
    for (const t of [0, 50, 1000, BUBBLE_MS - 100]) expect(bubblePop(t, true).scale).toBe(1);
    expect(bubblePop(1000, true).alpha).toBe(1);
  });

  it("a large bubble (an emote) pops bigger, wobbles then settles, and lasts LARGE_BUBBLE_MS; reduced motion only fades", () => {
    const peak = (size: "small" | "large") => Math.max(...Array.from({ length: 40 }, (_, i) => bubblePop(i * 8, false, size).scale));
    expect(peak("large")).toBeGreaterThan(peak("small") + 0.05);
    expect(Math.max(...[40, 80, 120, 160].map((t) => Math.abs(bubblePop(t, false, "large").rot)))).toBeGreaterThan(0.03);
    expect(bubblePop(600, false, "large")).toEqual({ scale: 1, alpha: 1, rot: 0 });
    expect(bubblePop(BUBBLE_MS, false, "large").alpha).toBe(1);
    expect(bubblePop(LARGE_BUBBLE_MS, false, "large").alpha).toBe(0);
    for (const t of [0, 60, 120, 1000]) expect(bubblePop(t, true, "large")).toMatchObject({ scale: 1, rot: 0 });
  });

  it("centres a bubble over its companion, sliding it inside the window near an edge with the tail still on the companion", () => {
    const at = (x: number) => ({ x, y: 400, footY: 470 });
    const place = (x: number, w: number, viewW = 1280) => placeBubble(at(x), w, 50, 10, viewW, 800);
    expect(place(500, 200)).toEqual({ left: 400, top: 340, tail: 100, below: false });
    // Near the left edge: the body slides right, the tail moves left to keep pointing at x = 60.
    expect(place(60, 200)).toMatchObject({ left: BUBBLE_MARGIN, tail: 60 - BUBBLE_MARGIN });
    // Near the right edge.
    expect(place(1270, 200)).toMatchObject({ left: 1280 - 200 - BUBBLE_MARGIN, tail: 200 - 22 });
    // The tail never runs into the rounded corners, even for a companion right at the edge.
    expect(place(0, 200).tail).toBe(22);
    // Wider than the window: centred.
    expect(place(100, 400, 300).left).toBe(-50);
  });

  it("goes under the companion, tail up, when the top of the window would cut it off; pinned to the top if neither fits", () => {
    const place = (y: number, footY: number, viewH = 800) => placeBubble({ x: 500, y, footY }, 200, 50, 10, 1280, viewH);
    // Just enough room above: stays above.
    expect(place(BUBBLE_MARGIN + 60, 130)).toMatchObject({ top: BUBBLE_MARGIN, below: false });
    // One pixel short: under the feet, the tail's length below them.
    expect(place(BUBBLE_MARGIN + 59, 130)).toMatchObject({ top: 140, below: true });
    // A head off the top of the window (the feet still in view).
    expect(place(-30, 40)).toMatchObject({ top: 50, below: true });
    // A tiny window where it fits neither way: above, pinned to the top edge.
    expect(place(20, 60, 100)).toMatchObject({ top: BUBBLE_MARGIN, below: false });
  });
});
