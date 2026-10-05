import { describe, expect, it } from "vitest";
import { cooldownLeft, EMOTE_COOLDOWN_MS, emoteBadge, stepWedge, wedgeAngle, wedgeAt, wedgeCenter, wedgePath, wheelCenter, wheelExtrasAbove, UNDER_WHEEL_PX, WHEEL_HOLE, WHEEL_R } from "../src/client/table/emoteWheel";
import { EMOTE_COUNT } from "../src/shared/companionKit";
import { EMOTE_COOLDOWN_MS as SERVER_COOLDOWN_MS } from "../src/shared/room";
import { ICONS } from "../src/client/icons";

describe("emote wheel", () => {
  it("has six wedges clockwise from the top, in the kit's order", () => {
    expect(EMOTE_COUNT).toBe(6);
    expect([0, 1, 2, 3, 4, 5].map(wedgeAngle)).toEqual([0, 60, 120, 180, 240, 300]);
    const mid = (WHEEL_R + WHEEL_HOLE) / 2;
    // Straight up is the first (cheer), straight down the fourth (silly); right of top is the second (love).
    expect(wedgeAt(0, -mid)).toBe(0);
    expect(wedgeAt(mid, -mid)).toBe(1); // 45°
    expect(wedgeAt(0, mid)).toBe(3);
    expect(wedgeAt(-mid, -mid)).toBe(5); // 315°
  });

  it("finds each wedge at its own centre, and none in the hole or past the rim", () => {
    for (let i = 0; i < EMOTE_COUNT; i++) {
      const c = wedgeCenter(i);
      expect(wedgeAt(c.x, c.y)).toBe(i);
    }
    expect(wedgeAt(0, 0)).toBeNull();
    expect(wedgeAt(0, -(WHEEL_HOLE - 1))).toBeNull();
    expect(wedgeAt(0, -(WHEEL_R + 1))).toBeNull();
    expect(wedgeAt(0, -WHEEL_HOLE)).toBe(0);
    expect(wedgeAt(0, -WHEEL_R)).toBe(0);
  });

  it("splits wedges at ±30° around each centre", () => {
    const at = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return wedgeAt(Math.sin(a) * 90, -Math.cos(a) * 90);
    };
    expect(at(29)).toBe(0);
    expect(at(31)).toBe(1);
    expect(at(-29)).toBe(0);
    expect(at(-31)).toBe(5);
    expect(at(149)).toBe(2);
    expect(at(151)).toBe(3);
  });

  it("draws each wedge as a closed ring segment inside the wheel's box", () => {
    for (let i = 0; i < EMOTE_COUNT; i++) {
      const d = wedgePath(i);
      expect(d).toMatch(/^M[\d. ]+L[\d. ]+A[\d. ]+L[\d. ]+A[\d. ]+Z$/);
      const nums = d.match(/-?[\d.]+/g)!.map(Number);
      expect(Math.min(...nums)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...nums)).toBeLessThanOrEqual(WHEEL_R * 2);
    }
  });

  it("keeps the whole ring on screen: centred on the click, nudged in near an edge", () => {
    expect(wheelCenter(500, 400, 1280, 800)).toEqual({ x: 500, y: 400 });
    const edge = WHEEL_R + 8;
    expect(wheelCenter(10, 790, 1280, 800)).toEqual({ x: edge, y: 800 - edge });
    expect(wheelCenter(1279, 5, 1280, 800)).toEqual({ x: 1280 - edge, y: edge });
    // A screen too small for it: centred.
    expect(wheelCenter(10, 10, 200, 200)).toEqual({ x: 100, y: 100 });
  });

  it("puts Edit lines and the line under the ring, over it only when there's less room below than above", () => {
    // Plenty of room below.
    expect(wheelExtrasAbove(400, 800)).toBe(false);
    // Near the bottom of a tall window: over.
    const atBottom = wheelCenter(600, 790, 1280, 800).y;
    expect(wheelExtrasAbove(atBottom, 800)).toBe(true);
    expect(wheelExtrasAbove(800 - WHEEL_R - UNDER_WHEEL_PX, 800)).toBe(false);
    expect(wheelExtrasAbove(800 - WHEEL_R - UNDER_WHEEL_PX + 1, 800)).toBe(true);
    // A short window (a landscape phone), ring pushed to the top: 80 px below beats 8 px above, so it stays
    // under (it used to go over, off the top of the screen).
    const atTop = wheelCenter(400, 100, 1280, 360).y;
    expect(atTop).toBe(WHEEL_R + 8);
    expect(wheelExtrasAbove(atTop, 360)).toBe(false);
    // Same window, ring pushed to the bottom: over, where the room is.
    expect(wheelExtrasAbove(wheelCenter(400, 350, 1280, 360).y, 360)).toBe(true);
  });

  it("arrow keys walk round the wheel, starting at the top", () => {
    expect(stepWedge(null, 1)).toBe(0);
    expect(stepWedge(null, -1)).toBe(5);
    expect(stepWedge(0, 1)).toBe(1);
    expect(stepWedge(5, 1)).toBe(0);
    expect(stepWedge(0, -1)).toBe(5);
  });

  it("cools down for EMOTE_COOLDOWN_MS, a little longer than the room's own guard", () => {
    expect(cooldownLeft(-Infinity, 0)).toBe(0);
    expect(cooldownLeft(1000, 1000)).toBe(EMOTE_COOLDOWN_MS);
    expect(cooldownLeft(1000, 1000 + EMOTE_COOLDOWN_MS - 1)).toBe(1);
    expect(cooldownLeft(1000, 1000 + EMOTE_COOLDOWN_MS)).toBe(0);
    // The client never sends faster than the server accepts, so a normal player's emotes are never dropped.
    expect(EMOTE_COOLDOWN_MS).toBeGreaterThan(SERVER_COOLDOWN_MS);
  });

  it("gives each emote an icon from the set and its own colour", () => {
    const badges = Array.from({ length: EMOTE_COUNT }, (_, i) => emoteBadge(i));
    for (const b of badges) expect(ICONS).toHaveProperty(b.icon);
    expect(new Set(badges.map((b) => b.color)).size).toBe(EMOTE_COUNT);
  });
});
