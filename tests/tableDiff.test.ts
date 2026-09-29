import { describe, expect, it } from "vitest";
import { applyTableAction, createTable, shownId, tableViewFor, type TableAction, type TableEnv } from "../src/shared/table";
import { mulberry32 } from "../src/shared/rng";
import type { DeckState, TableState } from "../src/shared/types";
import { diffTables, type Spot } from "../src/client/table/tableDiff";
import { basicIds, makeCube } from "./fixtures";

function setup() {
  let n = 0;
  const env: TableEnv = { cards: makeCube(100), rng: mulberry32(3), now: 0, nextId: (p) => `${p}${n++}`, names: { a: "Alice", b: "Bob" } };
  const instances: Record<string, { iid: string; cardId: string }> = {};
  const deck = (prefix: string): DeckState => {
    const main = Array.from({ length: 23 }, (_, i) => {
      const iid = `${prefix}${i}`;
      instances[iid] = { iid, cardId: `card-${i}` };
      return iid;
    });
    return { main, side: [], basics: { W: 17, U: 0, B: 0, R: 0, G: 0, C: 0 }, ready: true };
  };
  const table = createTable(["a", "b"], { a: deck("xa"), b: deck("xb") }, instances, basicIds, { startingLife: 20, openingHandSize: 7 }, env);
  return { table, env };
}

/** Applies an action and returns what player `viewer` sees before and after (as the client gets it). */
function step(table: TableState, env: TableEnv, by: string, action: TableAction, viewer = "a") {
  const before = structuredClone(tableViewFor(table, viewer));
  applyTableAction(table, by, action, env);
  const after = structuredClone(tableViewFor(table, viewer));
  return diffTables(before, after);
}

describe("table diff", () => {
  it("reports nothing without a previous state, or for an unrelated table", () => {
    const { table } = setup();
    const other = setup().table;
    other.seats = ["b", "a"];
    expect(diffTables(null, table).hops).toEqual([]);
    expect(diffTables(table, other).hops).toEqual([]);
  });

  it("treats a new game with the same seats as unrelated", () => {
    const { table, env } = setup();
    for (const id of table.players.a.zones.hand.slice(0, 3)) applyTableAction(table, "a", { a: "move", ids: [id], to: "battlefield" }, env);
    const fresh = setup().table;
    expect(fresh.nextZ).toBeLessThan(table.nextZ);
    expect(diffTables(table, fresh)).toEqual({ hops: [], shuffled: [], mulligans: [], taps: [], renamed: {} });
  });

  it("sees a draw as library → hand", () => {
    const { table, env } = setup();
    const top = table.players.a.zones.library[0];
    const d = step(table, env, "a", { a: "draw", n: 1 });
    expect(d.hops).toHaveLength(1);
    expect(d.hops[0]).toMatchObject({ id: top, from: { kind: "pile", owner: "a", zone: "library" }, to: { kind: "hand", owner: "a" }, phase: 0 });
  });

  it("sees an opponent playing a card from their hidden hand", () => {
    const { table, env } = setup();
    const id = table.players.b.zones.hand[0];
    const d = step(table, env, "b", { a: "move", ids: [id], to: "battlefield", x: 0, y: 0 });
    expect(d.hops).toHaveLength(1);
    expect(d.hops[0].from).toEqual({ kind: "hand", owner: "b" });
    expect(d.hops[0].to).toEqual({ kind: "battlefield" });
    // Hidden before, shown after: the client flips it over mid-flight.
    expect(d.hops[0].prev?.hidden).toBe(true);
    expect(d.hops[0].next?.cardId).toBeDefined();
  });

  it("ignores moves around the battlefield, but reports several taps at once in table order", () => {
    const { table, env } = setup();
    const [p, q] = table.players.a.zones.hand;
    applyTableAction(table, "a", { a: "move", ids: [p], to: "battlefield", x: 5, y: 0 }, env);
    applyTableAction(table, "a", { a: "move", ids: [q], to: "battlefield", x: -5, y: 0 }, env);
    expect(step(table, env, "a", { a: "setPos", id: p, x: 3, y: 1 }).hops).toEqual([]);
    expect(step(table, env, "a", { a: "tap", ids: [p] }).taps).toEqual([]);
    applyTableAction(table, "a", { a: "tap", ids: [q] }, env);
    const d = step(table, env, "a", { a: "untapAll" });
    expect(d.taps).toEqual([q, p]);
  });

  it("turns a mulligan into two legs: the old hand into the library, then a new hand out of it", () => {
    const { table, env } = setup();
    const oldHand = table.players.a.zones.hand.slice();
    const d = step(table, env, "a", { a: "mulligan" });
    const newHand = table.players.a.zones.hand;
    expect(d.mulligans).toEqual(["a"]);
    expect(d.shuffled).toContain("a");
    const out = d.hops.filter((h) => h.phase === 0);
    const back = d.hops.filter((h) => h.phase === 1);
    expect(out.map((h) => h.id).sort()).toEqual(oldHand.slice().sort());
    expect(out.every((h) => h.to.kind === "pile" && h.to.zone === "library")).toBe(true);
    expect(back.map((h) => h.id)).toEqual(newHand);
    expect(back.every((h) => h.from.kind === "pile" && h.to.kind === "hand")).toBe(true);
  });

  it("doesn't mistake putting a library card on the top or bottom (scry) for a shuffle", () => {
    const { table, env } = setup();
    const lib = table.players.a.zones.library;
    const toBottom = step(table, env, "a", { a: "move", ids: [lib[0]], to: "library", bottom: true });
    expect(toBottom.shuffled).toEqual([]);
    expect(toBottom.hops).toEqual([]);
    const fifth = table.players.a.zones.library[4];
    expect(step(table, env, "a", { a: "move", ids: [fifth], to: "library" }).shuffled).toEqual([]);
  });

  it("detects a shuffle, and tokens appearing and disappearing", () => {
    const { table, env } = setup();
    expect(step(table, env, "a", { a: "shuffle" }).shuffled).toEqual(["a"]);
    const made = step(table, env, "a", { a: "token", token: { name: "Goblin", colors: ["R"] } });
    expect(made.hops).toHaveLength(1);
    expect(made.hops[0].from).toEqual({ kind: "none" });
    const token = made.hops[0].id;
    const gone = step(table, env, "a", { a: "move", ids: [token], to: "graveyard" });
    expect(gone.hops[0]).toMatchObject({ id: token, from: { kind: "battlefield" }, to: { kind: "none" } });
  });

  describe("from the other side of the table (Bob watching Alice)", () => {
    const watch = (table: TableState, env: TableEnv, action: TableAction) => step(table, env, "a", action, "b");
    const lib: Spot = { kind: "pile", owner: "a", zone: "library" };
    const hand: Spot = { kind: "hand", owner: "a" };

    it("sees a draw as library → hand", () => {
      const { table, env } = setup();
      const top = tableViewFor(table, "b").players.a.zones.library[0];
      const d = watch(table, env, { a: "draw", n: 1 });
      expect(d.hops).toEqual([expect.objectContaining({ id: top, fromId: top, from: lib, to: hand })]);
      expect(d.shuffled).toEqual([]);
    });

    it("follows a card played from the hand to its real id, from the stand-in it had", () => {
      const { table, env } = setup();
      const id = table.players.a.zones.hand[2];
      const standIn = shownId(table, "b", id);
      const d = watch(table, env, { a: "move", ids: [id], to: "battlefield", x: 0, y: 0 });
      expect(d.hops).toEqual([expect.objectContaining({ id, fromId: standIn, from: hand, to: { kind: "battlefield" } })]);
      expect(d.hops[0].prev?.hidden).toBe(true);
      expect(d.hops[0].next?.cardId).toBeDefined();
    });

    it("sees milled cards turn up in the graveyard in order", () => {
      const { table, env } = setup();
      const top = tableViewFor(table, "b").players.a.zones.library.slice(0, 2);
      const d = watch(table, env, { a: "mill", n: 2 });
      expect(d.hops.map((h) => [h.fromId, h.id])).toEqual(top.map((id, i) => [id, table.players.a.zones.graveyard[i]]));
      expect(d.hops.every((h) => h.to.kind === "pile" && h.to.zone === "graveyard")).toBe(true);
    });

    it("doesn't mistake scrying to the top or bottom for a shuffle", () => {
      const { table, env } = setup();
      applyTableAction(table, "a", { a: "peek", n: 2 }, env);
      const [c1, c2] = table.players.a.zones.library;
      expect(watch(table, env, { a: "move", ids: [c1], to: "library", bottom: true })).toMatchObject({ hops: [], shuffled: [] });
      expect(watch(table, env, { a: "move", ids: [c2], to: "library" })).toMatchObject({ hops: [], shuffled: [] });
    });

    it("sees a card found by a search fly library → hand, the rest of the library renamed", () => {
      const { table, env } = setup();
      applyTableAction(table, "a", { a: "peek", n: 0, search: true }, env);
      const d = watch(table, env, { a: "move", ids: [table.players.a.zones.library[10]], to: "hand" });
      expect(d.hops).toEqual([expect.objectContaining({ from: lib, to: hand })]);
      expect(Object.keys(d.renamed)).toHaveLength(32);
      expect(d.shuffled).toEqual([]);
    });

    it("sees a shuffle by its counter, with every library card renamed rather than moved", () => {
      const { table, env } = setup();
      const d = watch(table, env, { a: "shuffle" });
      expect(d.shuffled).toEqual(["a"]);
      expect(d.hops).toEqual([]);
      expect(Object.keys(d.renamed)).toHaveLength(33);
    });

    it("sees a mulligan as the old hand out, then a new hand in", () => {
      const { table, env } = setup();
      const oldHand = tableViewFor(table, "b").players.a.zones.hand;
      const d = watch(table, env, { a: "mulligan" });
      const newHand = tableViewFor(table, "b").players.a.zones.hand;
      expect(d.mulligans).toEqual(["a"]);
      expect(d.shuffled).toEqual(["a"]);
      expect(d.hops.filter((h) => h.phase === 0).map((h) => [h.id, h.from, h.to])).toEqual(oldHand.map((id) => [id, hand, lib]));
      expect(d.hops.filter((h) => h.phase === 1).map((h) => [h.id, h.from, h.to])).toEqual(newHand.map((id) => [id, lib, hand]));
    });

    it("sees a card go from the hand face down, then turn up in place", () => {
      const { table, env } = setup();
      const id = table.players.a.zones.hand[0];
      const down = watch(table, env, { a: "move", ids: [id], to: "battlefield", x: 0, y: 0, faceDown: true });
      // The whole hand got new stand-ins; only one card actually went anywhere.
      expect(down.hops).toEqual([expect.objectContaining({ id: shownId(table, "b", id), from: hand, to: { kind: "battlefield" } })]);
      expect(Object.keys(down.renamed)).toHaveLength(6);
      const standIn = shownId(table, "b", id);
      const up = watch(table, env, { a: "flip", ids: [id] });
      expect(up.hops).toEqual([]);
      expect(up.renamed).toEqual({ [standIn]: id });
    });

    it("sees a card put from the hand on top of the library", () => {
      const { table, env } = setup();
      const id = table.players.a.zones.hand[3];
      const d = watch(table, env, { a: "move", ids: [id], to: "library" });
      expect(d.hops).toEqual([expect.objectContaining({ id: tableViewFor(table, "b").players.a.zones.library[0], from: hand, to: lib })]);
      expect(d.shuffled).toEqual([]);
    });
  });
});
