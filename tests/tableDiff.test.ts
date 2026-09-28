import { describe, expect, it } from "vitest";
import { applyTableAction, createTable, tableViewFor, type TableAction, type TableEnv } from "../src/shared/table";
import { mulberry32 } from "../src/shared/rng";
import type { DeckState, TableState } from "../src/shared/types";
import { diffTables, oneCardMoved } from "../src/client/table/tableDiff";
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
    expect(diffTables(table, fresh)).toEqual({ hops: [], shuffled: [], mulligans: [], taps: [] });
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
    expect(oneCardMoved(["a", "b", "c", "d"], ["b", "c", "d", "a"])).toBe(true);
    expect(oneCardMoved(["a", "b", "c", "d"], ["a", "d", "b", "c"])).toBe(true);
    expect(oneCardMoved(["a", "b", "c", "d"], ["b", "a", "d", "c"])).toBe(false);
    expect(oneCardMoved(["a", "b", "c"], ["a", "b", "c"])).toBe(false);
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
});
