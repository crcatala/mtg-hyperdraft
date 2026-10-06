import { describe, expect, it } from "vitest";
import { CARD_H, pileAt, pilePosition, PILE_LOCAL, type PileZone } from "../src/shared/tableLayout";

const ZONES = Object.keys(PILE_LOCAL) as PileZone[];

describe("pile layout", () => {
  it("keeps library, graveyard and exile together on one side, each its own slot, and the sideboard on the other", () => {
    const { library, graveyard, exile, sideboard } = PILE_LOCAL;
    // One column beside the battlefield (the tournament rules let the player pick the side).
    expect(graveyard.x).toBe(library.x);
    expect(exile.x).toBe(library.x);
    expect(Math.sign(sideboard.x)).toBe(-Math.sign(library.x));
    // Distinct slots in that column: library, then graveyard, then exile, none overlapping.
    for (const [a, b] of [
      [library, graveyard],
      [graveyard, exile],
    ]) {
      expect(a.y - b.y).toBeGreaterThanOrEqual(CARD_H);
    }
  });

  it("finds each pile at its own centre, at every seat of every table size", () => {
    for (let n = 1; n <= 4; n++) {
      for (let seat = 0; seat < n; seat++) {
        for (const zone of ZONES) expect(pileAt(pilePosition(zone, seat, n), n), `${zone} ${seat}/${n}`).toEqual({ seat, zone });
      }
    }
  });
});
