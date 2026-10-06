import { describe, expect, it } from "vitest";
import { introProgress, pauseIntro, resumeIntro, type IntroClock } from "../src/client/table/cameraIntro";

const MS = 1000;

describe("the table's opening shot", () => {
  it("runs from 0 to 1 over its length, and hasn't started before its first frame", () => {
    const c: IntroClock = { start: -1 };
    expect(introProgress(c, 500, MS)).toBe(0);
    c.start = 100;
    expect(introProgress(c, 600, MS)).toBe(0.5);
    expect(introProgress(c, 5000, MS)).toBe(1);
  });

  it("holds still while a pointer is down, so a drag during the glide sees one camera from grab to drop", () => {
    const c: IntroClock = { start: 0 };
    pauseIntro(c, 300);
    // Grabbing a card and dragging it for a while: the camera doesn't move.
    expect(introProgress(c, 300, MS)).toBe(0.3);
    expect(introProgress(c, 900, MS)).toBe(0.3);
    expect(introProgress(c, 4000, MS)).toBe(0.3);
    // A second finger going down doesn't restart the pause.
    pauseIntro(c, 2000);
    resumeIntro(c, 4000);
    // Let go: it carries on from where it stopped, the paused time not counted.
    expect(introProgress(c, 4000, MS)).toBe(0.3);
    expect(introProgress(c, 4700, MS)).toBe(1);
  });

  it("ignores a release without a press, and a press before the first frame", () => {
    const c: IntroClock = { start: -1 };
    pauseIntro(c, 50);
    expect(c.pausedAt).toBeUndefined();
    c.start = 100;
    resumeIntro(c, 400);
    expect(introProgress(c, 600, MS)).toBe(0.5);
  });
});
