import { describe, expect, it } from "vitest";
import { placeBeside } from "../src/client/placement";
import { cubeCards, matchesName } from "../src/client/cubeList";
import { makeCard, makeCube } from "./fixtures";

const viewport = { width: 1000, height: 800 };
const rect = (left: number, top: number, width = 100, height = 140) => ({ left, top, right: left + width, width, height });
const box = { width: 250, height: 350 };

describe("placeBeside", () => {
  it("uses the preferred side when there is room", () => {
    expect(placeBeside(rect(100, 300), box, viewport, { prefer: "right" })).toMatchObject({ side: "right", left: 214 });
    expect(placeBeside(rect(600, 300), box, viewport, { prefer: "left" })).toMatchObject({ side: "left", left: 336 });
  });

  it("flips to the other side near the viewport edge", () => {
    // Anchor near the right edge: no room on the right.
    expect(placeBeside(rect(850, 300), box, viewport, { prefer: "right" }).side).toBe("left");
    // Anchor near the left edge: no room on the left.
    expect(placeBeside(rect(20, 300), box, viewport, { prefer: "left" }).side).toBe("right");
  });

  it("picks the roomier side and stays on screen when neither side fits", () => {
    const p = placeBeside(rect(300, 300, 400), { width: 400, height: 350 }, viewport);
    expect(p.side).toBe("right");
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + 400).toBeLessThanOrEqual(viewport.width - 8);
  });

  it("centres vertically on the anchor, clamped to the viewport", () => {
    expect(placeBeside(rect(100, 300), box, viewport).top).toBe(300 + 70 - 175);
    expect(placeBeside(rect(100, 0), box, viewport).top).toBe(8);
    expect(placeBeside(rect(100, 760), box, viewport).top).toBe(800 - 8 - 350);
  });

  it("keeps the top margin when the box is taller than the viewport", () => {
    expect(placeBeside(rect(100, 300), { width: 250, height: 900 }, viewport).top).toBe(8);
  });
});

describe("cubeCards", () => {
  it("drops the basics the import adds and sorts by colour, spells before lands, mana value, name", () => {
    const cards = makeCube(6);
    cards["land"] = makeCard(90, { id: "land", name: "Aaa Land", typeLine: "Land", colors: [], cmc: 0 });
    cards["art"] = makeCard(91, { id: "art", name: "Zzz Artifact", typeLine: "Artifact", colors: [], cmc: 3 });
    cards["gold"] = makeCard(92, { id: "gold", name: "Gold", colors: ["W", "U"], cmc: 2 });
    cards["w1"] = makeCard(93, { id: "w1", name: "Cheap White", colors: ["W"], cmc: 1 });
    const basicIds = { W: "basic-W", U: "basic-U", B: "basic-B", R: "basic-R", G: "basic-G", C: "basic-C" };
    const ids = cubeCards(cards, basicIds).map((c) => c.id);
    expect(ids.some((id) => id.startsWith("basic-"))).toBe(false);
    expect(ids).toEqual(["w1", "card-0", "card-5", "card-1", "card-2", "card-3", "card-4", "gold", "art", "land"]);
  });

  it("drops synthetic basics even without their ids", () => {
    const cards = { a: makeCard(1, { id: "a" }), b: makeCard(2, { id: "b", basic: "W" }) };
    expect(cubeCards(cards).map((c) => c.id)).toEqual(["a"]);
  });
});

describe("matchesName", () => {
  it("ignores case, accents and surrounding space", () => {
    const card = makeCard(1, { name: "Lim-Dûl's Vault" });
    expect(matchesName(card, "  lim-dul")).toBe(true);
    expect(matchesName(card, "VAULT")).toBe(true);
    expect(matchesName(card, "bolt")).toBe(false);
    expect(matchesName(card, "")).toBe(true);
  });
});
