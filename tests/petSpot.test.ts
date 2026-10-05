import { describe, expect, it } from "vitest";
import { companionSpot, localToTable, MAT_D, MAT_W, PET_MARGIN, PET_MARGIN_DEPTH, petSpotValid, PILE_LOCAL, tableRadius } from "../src/shared/tableLayout";

describe("where a companion may be put down (petSpotValid)", () => {
  it("accepts every seat's home spot, at every table size", () => {
    for (let n = 1; n <= 4; n++) for (let seat = 0; seat < n; seat++) expect(petSpotValid(companionSpot(seat, n), n, seat), `${seat}/${n}`).toBe(true);
  });

  /** Points on and just around a mat, in its seat's local coordinates: its middle, corners, a pile, just past each edge. */
  const ON_MAT = [
    [0, 0],
    [MAT_W / 2 - 0.1, MAT_D / 2 - 0.1],
    [-MAT_W / 2 + 0.1, -MAT_D / 2 + 0.1],
    [PILE_LOCAL.library.x, PILE_LOCAL.library.y],
    [MAT_W / 2 + PET_MARGIN - 0.05, 0],
    [-MAT_W / 2 - PET_MARGIN + 0.05, 0],
    [0, -MAT_D / 2 - PET_MARGIN_DEPTH + 0.05],
    [3, MAT_D / 2 + PET_MARGIN_DEPTH - 0.05],
  ];

  it("refuses everyone else's mat, including a margin around its edges", () => {
    for (let n = 1; n <= 4; n++) {
      for (let seat = 0; seat < n; seat++) {
        const local = (x: number, y: number) => localToTable({ x, y }, seat, n);
        // Seen by every other seat at the table, and by nobody's (no seat at all).
        for (const by of [-1, ...Array.from({ length: n }, (_, i) => i).filter((i) => i !== seat)]) {
          for (const [x, y] of ON_MAT) expect(petSpotValid(local(x, y), n, by), `${seat}/${n} by ${by} at ${x},${y}`).toBe(false);
        }
        // Clear of the margin beside the mat (left and right edges, where nothing else is in the way).
        expect(petSpotValid(local(-MAT_W / 2 - PET_MARGIN - 0.05, -2), n, -1), `${seat}/${n} left`).toBe(true);
      }
    }
  });

  it("accepts the companion's own player's mat anywhere: over cards, piles, the deck", () => {
    for (let n = 1; n <= 4; n++) {
      for (let seat = 0; seat < n; seat++) {
        for (const [x, y] of ON_MAT) {
          const p = localToTable({ x, y }, seat, n);
          // Points just past its edges can still be in a neighbour's margin at 3-4 seats; the mat itself is its own.
          const onIt = Math.abs(x) <= MAT_W / 2 && Math.abs(y) <= MAT_D / 2;
          if (onIt) expect(petSpotValid(p, n, seat), `${seat}/${n} at ${x},${y}`).toBe(true);
        }
      }
    }
  });

  it("refuses the table's rim and anything beyond it", () => {
    for (let n = 1; n <= 4; n++) {
      const r = tableRadius(n);
      // Halfway between two seats (or opposite the only one), where the rim is clear of the mats.
      const a = Math.PI / n;
      const at = (d: number) => ({ x: -d * Math.sin(a), y: d * Math.cos(a) });
      expect(petSpotValid(at(r - PET_MARGIN - 0.05), n, 0), `${n} inside the rim`).toBe(true);
      expect(petSpotValid(at(r - PET_MARGIN + 0.05), n, 0), `${n} on the rim`).toBe(false);
      expect(petSpotValid(at(r + 5), n, 0)).toBe(false);
      expect(petSpotValid({ x: 150, y: -150 }, n, 0)).toBe(false);
    }
  });

  it("accepts open table between the mats", () => {
    // Two seats face each other 9 from the middle, leaving a strip 5 wide between them (4 once the margins are off).
    expect(petSpotValid({ x: 0, y: 0 }, 2, 0)).toBe(true);
    expect(petSpotValid({ x: 4, y: 1.9 }, 2, 0)).toBe(true);
    expect(petSpotValid({ x: 4, y: -2.1 }, 2, 0)).toBe(false);
    // One seat: the far side of the table is free.
    expect(petSpotValid({ x: 0, y: -6 }, 1, 0)).toBe(true);
    // Three and four seats leave the centre of the table open too.
    expect(petSpotValid({ x: 0, y: 0 }, 3, 0)).toBe(true);
    expect(petSpotValid({ x: 0, y: 0 }, 4, 0)).toBe(true);
  });

  it("refuses points that aren't numbers", () => {
    expect(petSpotValid({ x: NaN, y: 0 }, 2, 0)).toBe(false);
    expect(petSpotValid({ x: 0, y: Infinity }, 2, 0)).toBe(false);
  });
});
