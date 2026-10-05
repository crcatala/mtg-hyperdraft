import { describe, expect, it } from "vitest";
import { handLayout, MAX_ARC_PX, MAX_EDGE_ROT_DEG } from "../src/client/table/handLayout";
import { relativeTime } from "../src/client/relativeTime";
import { RARITY_RANK, revealSchedule } from "../src/client/revealSchedule";
import type { LogEntry, Rarity } from "../src/shared/types";
import { countNewEntries, logKeys } from "../src/client/table/logFeed";
import { hopFade, HOP_SECONDS } from "../src/client/table/petMotion";
import { mergeLook } from "../src/client/identity";

describe("hand layout", () => {
  it("keeps a normal hand at full size with the classic fan", () => {
    const l = handLayout(7, 900);
    expect(l.width).toBe(150);
    expect(l.spread).toBeCloseTo(108);
    expect(l.rot(0)).toBeCloseTo(-6.6);
    expect(l.rot(3)).toBe(0);
    expect(l.arc(3)).toBe(0);
  });

  it("fits any hand size inside the available width, with bounded tilt and sink", () => {
    for (const avail of [420, 580, 1000]) {
      for (let n = 1; n <= 60; n++) {
        const l = handLayout(n, avail);
        expect(l.fanWidth).toBeLessThanOrEqual(Math.max(avail, l.width) + 1e-9);
        expect(Math.abs(l.rot(0))).toBeLessThanOrEqual(MAX_EDGE_ROT_DEG + 1e-9);
        expect(Math.abs(l.rot(n - 1))).toBeLessThanOrEqual(MAX_EDGE_ROT_DEG + 1e-9);
        expect(l.arc(0)).toBeLessThanOrEqual(MAX_ARC_PX + 1e-9);
        expect(l.arc(n - 1)).toBeLessThanOrEqual(MAX_ARC_PX + 1e-9);
      }
    }
  });

  it("shrinks cards before strips get too thin to hover", () => {
    const l = handLayout(25, 580);
    expect(l.spread).toBeGreaterThanOrEqual(16);
    expect(l.width).toBeGreaterThanOrEqual(70);
  });

  it("handles an empty hand", () => {
    expect(handLayout(0, 600).fanWidth).toBe(0);
  });
});

describe("relative time", () => {
  it("formats log ages", () => {
    expect(relativeTime(-500)).toBe("Just now");
    expect(relativeTime(59_000)).toBe("Just now");
    expect(relativeTime(60_000)).toBe("1 minute ago");
    expect(relativeTime(2 * 60_000 + 30_000)).toBe("2 minutes ago");
    expect(relativeTime(60 * 60_000)).toBe("1 hour ago");
    expect(relativeTime(5 * 60 * 60_000)).toBe("5 hours ago");
    expect(relativeTime(49 * 60 * 60_000)).toBe("2 days ago");
  });
});

describe("pack reveal schedule", () => {
  const ranks = (rs: Rarity[]) => rs.map((r) => RARITY_RANK[r]);
  const gaps = (plan: ReturnType<typeof revealSchedule>) => plan.reveals.slice(1).map((r, i) => r.at - plan.reveals[i].at);
  // A retail-style pack in reveal order: commons first, the rare / mythic last.
  const retail = revealSchedule(ranks([...Array<Rarity>(10).fill("common"), ...Array<Rarity>(3).fill("uncommon"), "rare", "mythic"]));
  // A cube pack: nearly everything is rare.
  const cube = revealSchedule(ranks([...Array<Rarity>(13).fill("rare"), "mythic", "mythic"]));
  const allRare = revealSchedule(ranks(Array<Rarity>(15).fill("rare")));

  it("opens any pack in under two seconds", () => {
    for (const plan of [retail, cube, allRare]) {
      expect(plan.reveals).toHaveLength(15);
      expect(plan.done).toBeLessThan(2000);
    }
  });

  it("flips in order, starting while the last cards are still being dealt", () => {
    const times = retail.reveals.map((r) => r.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(retail.reveals[0].at).toBeLessThan(retail.deals.at(-1)! + 400);
    expect(retail.done).toBeGreaterThan(times.at(-1)!);
  });

  it("saves suspense for the cards that stand out in their pack", () => {
    expect(retail.reveals.filter((r) => r.highlight).map((r) => r.k)).toEqual([13, 14]);
    expect(gaps(retail)[0]).toBeLessThan(60); // common → common: a quick wave
    expect(gaps(retail)[12]).toBeGreaterThan(gaps(retail)[0] * 3); // → the rare
    // Cube pack: only the mythics are special; the rares ripple past.
    expect(cube.reveals.filter((r) => r.highlight).map((r) => r.k)).toEqual([13, 14]);
    expect(Math.max(...gaps(cube).slice(0, 12))).toBeLessThan(60);
    // All rares: nothing stands out, so no drumrolls at all.
    expect(allRare.reveals.some((r) => r.highlight)).toBe(false);
    expect(allRare.done).toBeLessThan(1400);
  });
});

describe("game log feed", () => {
  const entry = (at: number, text = `event ${at}`): LogEntry => ({ at, playerId: "a", text });
  const log = [entry(1), entry(2), entry(3)];

  it("counts entries that arrived after the newest one seen", () => {
    expect(countNewEntries(null, log)).toBe(0);
    expect(countNewEntries(entry(3), log)).toBe(0);
    expect(countNewEntries(entry(1), log)).toBe(2);
    // The server trims old entries: new ones are still found relative to the last seen entry.
    expect(countNewEntries(entry(2), [entry(2), entry(3), entry(4)])).toBe(2);
    // Last seen entry already trimmed away: everything visible is new.
    expect(countNewEntries(entry(0), log)).toBe(3);
  });

  it("keeps keys stable when old entries are trimmed, and unique for repeats", () => {
    const before = logKeys([entry(1), entry(2), entry(3)]);
    const after = logKeys([entry(2), entry(3), entry(4)]);
    expect(after.slice(0, 2)).toEqual(before.slice(1));
    const dup = logKeys([entry(5, "tap"), entry(5, "tap")]);
    expect(new Set(dup).size).toBe(2);
  });
});

describe("companion hop timing", () => {
  it("hops at full height at first, eases off, and is at rest after five seconds", () => {
    expect(hopFade(0)).toBe(1);
    expect(hopFade(HOP_SECONDS - 1.5)).toBe(1);
    expect(hopFade(HOP_SECONDS - 0.75)).toBeCloseTo(0.5);
    expect(hopFade(HOP_SECONDS)).toBe(0);
    expect(hopFade(60)).toBe(0);
  });

  it("doesn't hop when it isn't their turn", () => {
    expect(hopFade(null)).toBe(0);
  });
});

describe("remembered avatar and companion", () => {
  it("keeps earlier picks when a later one is made before the room has caught up", () => {
    // Two quick picks in a row, each merged onto what was saved (not onto a stale room view).
    let saved = mergeLook({}, "avatar", "sable");
    saved = mergeLook(saved, "companion", "foil");
    expect(saved).toEqual({ avatar: "sable", companion: "foil" });
  });

  it("clears one choice without touching the other", () => {
    const saved = mergeLook({ avatar: "sable", companion: "foil" }, "avatar", null);
    expect(saved).toEqual({ companion: "foil" });
    expect("avatar" in saved).toBe(false);
  });
});
