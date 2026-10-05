import { describe, expect, it } from "vitest";
import { companionSpot, localToTable, MAT_D, MAT_W, matCenter, PET_MARGIN, petSpotValid, tableRadius } from "../src/shared/tableLayout";

describe("where a companion may be put down (petSpotValid)", () => {
  it("accepts every seat's home spot, at every table size", () => {
    for (let n = 1; n <= 4; n++) for (let seat = 0; seat < n; seat++) expect(petSpotValid(companionSpot(seat, n), n), `${seat}/${n}`).toBe(true);
  });

  it("refuses every seat's mat, not just the owner's, including a margin around its edges", () => {
    for (let n = 1; n <= 4; n++) {
      for (let seat = 0; seat < n; seat++) {
        const local = (x: number, y: number) => localToTable({ x, y }, seat, n);
        expect(petSpotValid(matCenter(seat, n), n)).toBe(false);
        // Corners, and just past each edge (inside the margin).
        for (const [x, y] of [
          [MAT_W / 2 - 0.1, MAT_D / 2 - 0.1],
          [-MAT_W / 2 + 0.1, -MAT_D / 2 + 0.1],
          [MAT_W / 2 + PET_MARGIN - 0.05, 0],
          [-MAT_W / 2 - PET_MARGIN + 0.05, 0],
          [0, -MAT_D / 2 - PET_MARGIN + 0.05],
        ]) {
          expect(petSpotValid(local(x, y), n), `${seat}/${n} at ${x},${y}`).toBe(false);
        }
        // Clear of the margin beside the mat (left and right edges, where nothing else is in the way).
        expect(petSpotValid(local(-MAT_W / 2 - PET_MARGIN - 0.05, -2), n), `${seat}/${n} left`).toBe(true);
      }
    }
  });

  it("refuses the table's rim and anything beyond it", () => {
    for (let n = 1; n <= 4; n++) {
      const r = tableRadius(n);
      // Halfway between two seats (or opposite the only one), where the rim is clear of the mats.
      const a = Math.PI / n;
      const at = (d: number) => ({ x: -d * Math.sin(a), y: d * Math.cos(a) });
      expect(petSpotValid(at(r - PET_MARGIN - 0.05), n), `${n} inside the rim`).toBe(true);
      expect(petSpotValid(at(r - PET_MARGIN + 0.05), n), `${n} on the rim`).toBe(false);
      expect(petSpotValid(at(r + 5), n)).toBe(false);
      expect(petSpotValid({ x: 150, y: -150 }, n)).toBe(false);
    }
  });

  it("accepts open table between the mats", () => {
    // Two seats face each other 9 from the middle, leaving a strip 5 wide between them (minus the margins).
    expect(petSpotValid({ x: 0, y: 0 }, 2)).toBe(true);
    expect(petSpotValid({ x: 0, y: 2 }, 2)).toBe(false);
    // One seat: the far side of the table is free.
    expect(petSpotValid({ x: 0, y: -6 }, 1)).toBe(true);
    // Three and four seats leave the centre of the table open too.
    expect(petSpotValid({ x: 0, y: 0 }, 3)).toBe(true);
    expect(petSpotValid({ x: 0, y: 0 }, 4)).toBe(true);
  });

  it("refuses points that aren't numbers", () => {
    expect(petSpotValid({ x: NaN, y: 0 }, 2)).toBe(false);
    expect(petSpotValid({ x: 0, y: Infinity }, 2)).toBe(false);
  });
});
