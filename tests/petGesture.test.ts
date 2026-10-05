import { describe, expect, it } from "vitest";
import { HOLD_MS, IDLE, MOVE_PX, pressGesture, stepGesture, type Gesture, type GestureEffect, type GestureEvent } from "../src/client/table/petGesture";

/** Runs events from a press at (100, 100), t = 1000; the effects in order (nulls left out) and the end state. */
function run(own: boolean, events: GestureEvent[]): { effects: GestureEffect[]; g: Gesture } {
  let g = pressGesture(own, 100, 100, 1000);
  const effects: GestureEffect[] = [];
  for (const ev of events) {
    const r = stepGesture(g, ev);
    g = r.g;
    if (r.effect) effects.push(r.effect);
  }
  return { effects, g };
}
const move = (x: number, y: number, t: number): GestureEvent => ({ type: "move", x, y, t });
const up = (t: number): GestureEvent => ({ type: "up", t });

describe("pressing a companion (petGesture)", () => {
  it("has the ticket's constants", () => {
    expect(HOLD_MS).toBe(250);
    expect(MOVE_PX).toBe(8);
  });

  it("a quick tap pokes, on anyone's companion, even with a little wobble", () => {
    for (const own of [true, false]) {
      expect(run(own, [up(1100)])).toEqual({ effects: ["poke"], g: IDLE });
      expect(run(own, [move(103, 104, 1050), move(105, 105, 1100), up(1200)]).effects).toEqual(["poke"]);
    }
  });

  it("holding your own companion picks it up at HOLD_MS; letting go puts it down", () => {
    expect(run(true, [move(100, 100, 1000 + HOLD_MS - 1)])).toEqual({ effects: [], g: expect.objectContaining({ phase: "pressing" }) });
    expect(run(true, [move(100, 100, 1000 + HOLD_MS)])).toEqual({ effects: ["lift"], g: { phase: "carrying" } });
    expect(run(true, [move(100, 100, 1000 + HOLD_MS), move(300, 200, 1500), up(1600)])).toEqual({ effects: ["lift", "drop"], g: IDLE });
  });

  it("moving your own companion past MOVE_PX picks it up at once, however quick", () => {
    expect(run(true, [move(100 + MOVE_PX - 0.5, 100, 1010)]).effects).toEqual([]);
    expect(run(true, [move(100 + MOVE_PX, 100, 1010)]).effects).toEqual(["lift"]);
    expect(run(true, [move(106, 106, 1020), up(1030)]).effects).toEqual(["lift", "drop"]);
  });

  it("never picks up someone else's companion: a long or moving press is still a poke on release", () => {
    expect(run(false, [move(100, 100, 3000), move(400, 400, 3100), up(5000)])).toEqual({ effects: ["poke"], g: IDLE });
  });

  it("a cancelled press does nothing; a cancelled carry puts it back", () => {
    expect(run(true, [{ type: "cancel" }])).toEqual({ effects: [], g: IDLE });
    expect(run(false, [{ type: "cancel" }, up(1100)])).toEqual({ effects: [], g: IDLE });
    expect(run(true, [move(120, 100, 1010), { type: "cancel" }, up(1200)])).toEqual({ effects: ["lift", "cancel"], g: IDLE });
  });

  it("only lifts once, and ignores everything once idle", () => {
    expect(run(true, [move(120, 100, 1010), move(140, 100, 1400), move(160, 100, 2000)]).effects).toEqual(["lift"]);
    expect(stepGesture(IDLE, up(5))).toEqual({ g: IDLE, effect: null });
    expect(stepGesture(IDLE, move(0, 0, 9999))).toEqual({ g: IDLE, effect: null });
  });

  it("a long press on your own that never lifted (a late timer) is neither a tap nor a drop", () => {
    expect(run(true, [up(1000 + HOLD_MS + 50)])).toEqual({ effects: [], g: IDLE });
  });
});
