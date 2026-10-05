import { describe, expect, it } from "vitest";
import { AVATARS, COMPANIONS, lowestFreeVariant, pickFree, variantColor, variantHue } from "../src/shared/roster";
import { MAX_SEATS } from "../src/shared/types";

// Keys only (the files aren't imported): which art files exist.
const art = new Set(Object.keys(import.meta.glob("/public/roster/**/*.webp")));

describe("roster", () => {
  it("has unique ids", () => {
    expect(new Set(AVATARS.map((a) => a.id)).size).toBe(AVATARS.length);
    expect(new Set(COMPANIONS.map((c) => c.id)).size).toBe(COMPANIONS.length);
  });

  it("has enough of each for every seat to be different", () => {
    expect(AVATARS.length).toBeGreaterThanOrEqual(MAX_SEATS);
    expect(COMPANIONS.length).toBeGreaterThanOrEqual(MAX_SEATS);
  });

  it("has art on disk for every entry", () => {
    for (const a of AVATARS) for (const f of [`${a.id}.webp`, `${a.id}-face.webp`]) expect(art.has(`/public/roster/avatars/${f}`), f).toBe(true);
    for (const c of COMPANIONS) for (const f of [`${c.id}.webp`, `${c.id}-sm.webp`]) expect(art.has(`/public/roster/companions/${f}`), f).toBe(true);
  });

  it("has art for the hooded stranger shown to players with no avatar", () => {
    expect(art.has("/public/roster/avatars/mystery.webp")).toBe(true);
    expect(art.has("/public/roster/avatars/mystery-face.webp")).toBe(true);
  });

  it("uses well-formed colours", () => {
    for (const d of [...AVATARS, ...COMPANIONS]) expect(d.color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("pickFree", () => {
  it("skips taken ids", () => {
    for (let i = 0; i < 20; i++) expect(pickFree(["a", "b", "c"], new Set(["a", "c"]), Math.random)).toBe("b");
  });
  it("falls back to any id when every one is taken", () => {
    expect(["a", "b"]).toContain(pickFree(["a", "b"], new Set(["a", "b"]), Math.random));
  });
});

describe("colour variants", () => {
  it("leaves the original alone and turns the hue for others", () => {
    expect(variantColor("#e0344a", 0)).toBe("#e0344a");
    const turned = variantColor("#e0344a", 1);
    expect(turned).toMatch(/^#[0-9a-f]{6}$/);
    expect(turned).not.toBe("#e0344a");
    expect(variantHue(1)).toBe(138);
  });

  it("gives each of the first eight variants a different hue", () => {
    expect(new Set(Array.from({ length: 8 }, (_, v) => variantHue(v))).size).toBe(8);
  });

  it("keeps greys grey", () => {
    expect(variantColor("#808080", 3)).toBe("#808080");
  });

  it("picks the lowest free variant", () => {
    expect(lowestFreeVariant([])).toBe(0);
    expect(lowestFreeVariant([0, 1, 3])).toBe(2);
  });
});
