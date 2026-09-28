import { describe, expect, it } from "vitest";
import { card, joinLog, logSegments, logText, num, player, verb } from "../src/shared/logText";

describe("log text", () => {
  it("builds the plain sentence and marks that point into it", () => {
    const line = logText`${player("a", "Alice")} ${verb("milled")} ${num(2)}: ${joinLog([card("Opt", "c1"), card("Brainstorm", "c2")], ", ")}.`;
    expect(line.text).toBe("Alice milled 2: Opt, Brainstorm.");
    expect(line.marks.map(([s, e, ...rest]) => [line.text.slice(s, e), ...rest])).toEqual([
      ["Alice", "p", "a"],
      ["milled", "v"],
      ["2", "n"],
      ["Opt", "c", "c1"],
      ["Brainstorm", "c", "c2"],
    ]);
  });

  it("nests pieces and leaves empty ones unmarked", () => {
    const whose = logText`${player("b", "Bob")}'s`;
    const line = logText`${whose} ${card("", "x")}card`;
    expect(line.text).toBe("Bob's card");
    expect(line.marks).toEqual([[0, 3, "p", "b"]]);
  });

  it("splits a line into plain and marked runs", () => {
    const line = logText`${player("a", "Alice")} tapped ${card("Opt", "c1")}.`;
    expect(logSegments(line.text, line.marks).map((s) => [s.text, s.mark?.[2]])).toEqual([
      ["Alice", "p"],
      [" tapped ", undefined],
      ["Opt", "c"],
      [".", undefined],
    ]);
    // Entries without marks (older games) are one plain run.
    expect(logSegments("Alice drew a card.")).toEqual([{ text: "Alice drew a card." }]);
  });

  it("shows malformed marks as plain text instead of garbling the line", () => {
    const segs = logSegments("Alice drew.", [
      [0, 5, "p", "a"],
      [3, 8, "v"], // overlaps the first
      [6, 99, "v"], // runs past the end
    ]);
    expect(segs.map((s) => s.text).join("")).toBe("Alice drew.");
    expect(segs.filter((s) => s.mark)).toHaveLength(1);
  });
});
