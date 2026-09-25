import { describe, expect, it } from "vitest";
import { autoBuild, colorPips, deckSize, suggestBasics } from "../src/shared/deck";
import { makeCard, makeCube } from "./fixtures";

describe("deck helpers", () => {
  it("counts coloured pips including hybrid", () => {
    expect(colorPips("{2}{W}{W}{U/B}")).toEqual({ W: 2, U: 0.5, B: 0.5, R: 0, G: 0 });
    expect(colorPips("{R/P}{G}")).toMatchObject({ R: 1, G: 1 });
  });

  it("suggests basics proportional to pips, filling to the target", () => {
    const main = [
      ...Array.from({ length: 15 }, (_, i) => makeCard(i, { manaCost: "{1}{W}", colors: ["W"] })),
      ...Array.from({ length: 8 }, (_, i) => makeCard(100 + i, { manaCost: "{U}", colors: ["U"] })),
    ];
    const basics = suggestBasics(main, 40);
    expect(Object.values(basics).reduce((a, b) => a + b, 0)).toBe(17);
    expect(basics.W).toBeGreaterThan(basics.U);
    expect(basics.U).toBeGreaterThan(0);
    expect(basics.B + basics.R + basics.G + basics.C).toBe(0);
  });

  it("uses Wastes for a colourless deck", () => {
    const main = Array.from({ length: 23 }, (_, i) => makeCard(i, { manaCost: "{3}", colors: [] }));
    expect(suggestBasics(main, 40).C).toBe(17);
  });

  it("auto-builds a legal 40-card two-colour deck", () => {
    const cards = makeCube(200);
    const instances: Record<string, { iid: string; cardId: string }> = {};
    const picks = Array.from({ length: 45 }, (_, i) => {
      instances[`i${i}`] = { iid: `i${i}`, cardId: `card-${i * 3}` };
      return `i${i}`;
    });
    const deck = autoBuild(picks, instances, cards);
    expect(deckSize(deck)).toBe(40);
    const colors = new Set(deck.main.flatMap((iid) => cards[instances[iid].cardId].colors));
    expect(colors.size).toBeLessThanOrEqual(2);
    expect(deck.main.length + deck.side.length).toBe(45);
  });
});
