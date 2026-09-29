import { describe, expect, it } from "vitest";
import { applyTableAction, createTable, TableError, tableViewFor, type TableEnv } from "../src/shared/table";
import { seatsFromMe } from "../src/shared/tableLayout";
import { mulberry32 } from "../src/shared/rng";
import type { CardInstance, DeckState } from "../src/shared/types";
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

describe("tabletop", () => {
  it("builds libraries with basics and draws opening hands", () => {
    const { table } = setup();
    expect(table.players.a.zones.hand).toHaveLength(7);
    expect(table.players.a.zones.library).toHaveLength(33);
    expect(table.players.b.life).toBe(20);
  });

  it("hides other players' hands and all libraries", () => {
    const { table } = setup();
    const view = tableViewFor(table, "a");
    const myHand = table.players.a.zones.hand[0];
    const theirHand = table.players.b.zones.hand[0];
    const myLib = table.players.a.zones.library[0];
    expect(view.cards[myHand].cardId).toBeDefined();
    expect(view.cards[theirHand].cardId).toBeUndefined();
    expect(view.cards[theirHand].hidden).toBe(true);
    expect(view.cards[myLib].cardId).toBeUndefined();
  });

  it("plays, taps, and returns cards; leaving the battlefield resets state", () => {
    const { table, env } = setup();
    const id = table.players.a.zones.hand[0];
    applyTableAction(table, "a", { a: "move", ids: [id], to: "battlefield", x: 1, y: 2 }, env);
    expect(table.cards[id]).toMatchObject({ zone: "battlefield", x: 1, y: 2 });
    applyTableAction(table, "a", { a: "tap", ids: [id] }, env);
    applyTableAction(table, "a", { a: "counter", id, kind: "+1/+1", delta: 2 }, env);
    expect(table.cards[id].tapped).toBe(true);
    applyTableAction(table, "a", { a: "move", ids: [id], to: "graveyard" }, env);
    expect(table.cards[id]).toMatchObject({ zone: "graveyard", tapped: false, counters: {} });
    expect(table.players.a.zones.graveyard).toEqual([id]);
    expect(table.log.at(-1)?.text).toMatch(/Alice moved .+ from the battlefield to their graveyard/);
  });

  it("places a dropped group of battlefield cards in one action", () => {
    const { table, env } = setup();
    const [x, y, inHand] = table.players.a.zones.hand;
    applyTableAction(table, "a", { a: "move", ids: [x, y], to: "battlefield", x: 0, y: 0 }, env);
    applyTableAction(table, "a", { a: "place", cards: [{ id: x, x: 5, y: 6 }, { id: y, x: 7, y: 8 }] }, env);
    expect(table.cards[x]).toMatchObject({ x: 5, y: 6 });
    expect(table.cards[y]).toMatchObject({ x: 7, y: 8 });
    expect(table.cards[y].z).toBeGreaterThan(table.cards[x].z);
    // All or nothing: a card that isn't on the battlefield refuses the whole group.
    expect(() => applyTableAction(table, "a", { a: "place", cards: [{ id: x, x: 1, y: 1 }, { id: inHand, x: 2, y: 2 }] }, env)).toThrow(TableError);
    expect(table.cards[x]).toMatchObject({ x: 5, y: 6 });
  });

  it("face-down cards are hidden from opponents but not their controller", () => {
    const { table, env } = setup();
    const id = table.players.a.zones.hand[0];
    applyTableAction(table, "a", { a: "move", ids: [id], to: "battlefield", faceDown: true }, env);
    expect(tableViewFor(table, "b").cards[id].cardId).toBeUndefined();
    expect(tableViewFor(table, "a").cards[id].cardId).toBeDefined();
    expect(table.log.at(-1)?.text).not.toMatch(/Card \d/);
  });

  it("blocks touching someone else's hand", () => {
    const { table, env } = setup();
    const theirs = table.players.b.zones.hand[0];
    expect(() => applyTableAction(table, "a", { a: "move", ids: [theirs], to: "graveyard" }, env)).toThrow(/private zone/);
  });

  it("draws, mills, peeks and mulligans", () => {
    const { table, env } = setup();
    applyTableAction(table, "a", { a: "draw", n: 2 }, env);
    expect(table.players.a.zones.hand).toHaveLength(9);
    applyTableAction(table, "a", { a: "mill", n: 3 }, env);
    expect(table.players.a.zones.graveyard).toHaveLength(3);
    applyTableAction(table, "a", { a: "peek", n: 3 }, env);
    const top = table.players.a.zones.library.slice(0, 3);
    const view = tableViewFor(table, "a");
    expect(top.every((id) => view.cards[id].cardId)).toBe(true);
    expect(tableViewFor(table, "b").cards[top[0]].cardId).toBeUndefined();
    applyTableAction(table, "a", { a: "mulligan" }, env);
    expect(table.players.a.zones.hand).toHaveLength(7);
  });

  describe("looking at the top of the library (scry / surveil)", () => {
    const lib = (table: ReturnType<typeof setup>["table"]) => table.players.a.zones.library;
    const looking = (table: ReturnType<typeof setup>["table"]) => tableViewFor(table, "a").peek.a;

    it("snapshots the top X cards instead of showing whatever is on top", () => {
      const { table, env } = setup();
      const top = lib(table).slice(0, 3);
      applyTableAction(table, "a", { a: "peek", n: 3 }, env);
      expect(table.peek.a).toEqual({ n: 3, ids: top });
      expect(table.log.at(-1)?.text).toMatch(/Alice looked at the top 3 card\(s\)/);
    });

    it("each card placed leaves the look, and the next library card never slides in", () => {
      const { table, env } = setup();
      const [c1, c2, c3, c4] = lib(table).slice(0, 4);
      applyTableAction(table, "a", { a: "peek", n: 3 }, env);
      applyTableAction(table, "a", { a: "move", ids: [c1], to: "graveyard" }, env);
      expect(table.peek.a.ids).toEqual([c2, c3]);
      expect(tableViewFor(table, "a").cards[c4].cardId).toBeUndefined();
      applyTableAction(table, "a", { a: "move", ids: [c3], to: "library", bottom: true }, env);
      expect(table.peek.a.ids).toEqual([c2]);
      expect(lib(table).at(-1)).toBe(c3);
    });

    it("putting a card back on top still takes it out of the look", () => {
      const { table, env } = setup();
      const [c1, c2, c3] = lib(table).slice(0, 3);
      applyTableAction(table, "a", { a: "peek", n: 3 }, env);
      applyTableAction(table, "a", { a: "move", ids: [c3], to: "library" }, env);
      expect(table.peek.a.ids).toEqual([c1, c2]);
      expect(lib(table).slice(0, 3)).toEqual([c3, c1, c2]);
      // No longer being looked at: hidden again like the rest of the library.
      expect(tableViewFor(table, "a").cards[c3].cardId).toBeUndefined();
    });

    it("logs where each card went without naming library cards", () => {
      const { table, env } = setup();
      const [c1, c2] = lib(table).slice(0, 2);
      applyTableAction(table, "a", { a: "peek", n: 2 }, env);
      applyTableAction(table, "a", { a: "move", ids: [c1], to: "library", bottom: true }, env);
      expect(table.log.at(-1)?.text).toBe("Alice moved a card to the bottom of their library.");
      applyTableAction(table, "a", { a: "move", ids: [c2], to: "library" }, env);
      expect(table.log.at(-1)?.text).toBe("Alice moved a card to the top of their library.");
    });

    it("still doesn't log other same-zone moves", () => {
      const { table, env } = setup();
      const id = table.players.a.zones.hand[0];
      const before = table.log.length;
      applyTableAction(table, "a", { a: "move", ids: [id], to: "hand" }, env);
      expect(table.log.length).toBe(before);
    });

    it("cards put on top one at a time stack: the last one placed ends up on top", () => {
      const { table, env } = setup();
      const [c1, c2, c3, c4] = lib(table).slice(0, 4);
      applyTableAction(table, "a", { a: "peek", n: 3 }, env);
      applyTableAction(table, "a", { a: "move", ids: [c1], to: "library" }, env);
      applyTableAction(table, "a", { a: "move", ids: [c3], to: "library" }, env);
      applyTableAction(table, "a", { a: "move", ids: [c2], to: "library" }, env);
      expect(lib(table).slice(0, 4)).toEqual([c2, c3, c1, c4]);
    });

    it("ends once every card has been placed", () => {
      const { table, env } = setup();
      const [c1, c2] = lib(table).slice(0, 2);
      applyTableAction(table, "a", { a: "peek", n: 2 }, env);
      applyTableAction(table, "a", { a: "move", ids: [c1], to: "library", bottom: true }, env);
      applyTableAction(table, "a", { a: "move", ids: [c2], to: "hand" }, env);
      expect(table.peek.a).toBeUndefined();
      expect(looking(table)).toBeUndefined();
    });

    it("closing early leaves the unplaced cards on top in their order", () => {
      const { table, env } = setup();
      const [c1, c2, c3] = lib(table).slice(0, 3);
      applyTableAction(table, "a", { a: "peek", n: 3 }, env);
      applyTableAction(table, "a", { a: "move", ids: [c2], to: "graveyard" }, env);
      applyTableAction(table, "a", { a: "peek", n: 0 }, env);
      expect(table.peek.a).toBeUndefined();
      expect(lib(table).slice(0, 2)).toEqual([c1, c3]);
      expect(tableViewFor(table, "a").cards[c1].cardId).toBeUndefined();
    });

    it("drawing or milling a looked-at card removes it from the look", () => {
      const { table, env } = setup();
      const [c1, c2, c3] = lib(table).slice(0, 3);
      applyTableAction(table, "a", { a: "peek", n: 3 }, env);
      applyTableAction(table, "a", { a: "draw", n: 1 }, env);
      applyTableAction(table, "a", { a: "mill", n: 1 }, env);
      expect(table.peek.a.ids).toEqual([c3]);
      expect(table.players.a.zones.hand).toContain(c1);
      expect(table.players.a.zones.graveyard).toContain(c2);
    });

    it("shuffling or taking a mulligan ends the look", () => {
      const { table, env } = setup();
      applyTableAction(table, "a", { a: "peek", n: 3 }, env);
      applyTableAction(table, "a", { a: "shuffle" }, env);
      expect(table.peek.a).toBeUndefined();
      applyTableAction(table, "a", { a: "peek", n: 3 }, env);
      applyTableAction(table, "a", { a: "mulligan" }, env);
      expect(table.peek.a).toBeUndefined();
    });

    it("clamps to the library size", () => {
      const { table, env } = setup();
      applyTableAction(table, "a", { a: "peek", n: 500 }, env);
      expect(table.peek.a.ids).toEqual(lib(table));
      expect(table.peek.a.search).toBeUndefined();
    });

    it("only the looking player sees the cards; everyone sees that they're looking", () => {
      const { table, env } = setup();
      const top = lib(table).slice(0, 2);
      applyTableAction(table, "a", { a: "peek", n: 2 }, env);
      const theirs = tableViewFor(table, "b");
      expect(theirs.peek).toEqual({});
      expect(top.every((id) => theirs.cards[id].cardId === undefined)).toBe(true);
      expect(top.every((id) => tableViewFor(table, "a").cards[id].cardId)).toBe(true);
      expect(theirs.looks).toEqual({ a: { kind: "top", n: 2, left: 2 } });
      expect(tableViewFor(table, "a").looks).toEqual({ a: { kind: "top", n: 2, left: 2 } });
      applyTableAction(table, "a", { a: "move", ids: [top[0]], to: "library", bottom: true }, env);
      expect(tableViewFor(table, "b").looks).toEqual({ a: { kind: "top", n: 2, left: 1 } });
      applyTableAction(table, "a", { a: "peek", n: 0 }, env);
      expect(tableViewFor(table, "b").looks).toEqual({});
    });

    it("everyone sees a search in progress, never the library", () => {
      const { table, env } = setup();
      applyTableAction(table, "a", { a: "peek", n: 0, search: true }, env);
      const theirs = tableViewFor(table, "b");
      expect(theirs.looks).toEqual({ a: { kind: "search" } });
      expect(lib(table).every((id) => theirs.cards[id].cardId === undefined)).toBe(true);
      applyTableAction(table, "a", { a: "shuffle" }, env);
      expect(tableViewFor(table, "b").looks).toEqual({});
    });

    it("a search shows the whole library, live, and placing cards doesn't end it", () => {
      const { table, env } = setup();
      applyTableAction(table, "a", { a: "peek", n: 0, search: true }, env);
      expect(table.peek.a).toMatchObject({ search: true, n: 33 });
      expect(table.log.at(-1)?.text).toMatch(/Alice is searching their library/);
      const [c1] = lib(table);
      applyTableAction(table, "a", { a: "move", ids: [c1], to: "hand" }, env);
      applyTableAction(table, "a", { a: "move", ids: [c1], to: "library", bottom: true }, env);
      const view = tableViewFor(table, "a");
      expect(view.peek.a?.search).toBe(true);
      expect(lib(table).every((id) => view.cards[id].cardId)).toBe(true);
    });

    it("treats a look saved by an older version (a bare count) as no look", () => {
      const { table, env } = setup();
      (table.peek as Record<string, unknown>).a = 3;
      const view = tableViewFor(table, "a");
      expect(view.peek).toEqual({});
      expect(view.cards[lib(table)[0]].cardId).toBeUndefined();
      // Moving cards around doesn't trip over it, and a new look replaces it.
      applyTableAction(table, "a", { a: "draw", n: 1 }, env);
      applyTableAction(table, "a", { a: "peek", n: 2 }, env);
      expect(table.peek.a.ids).toHaveLength(2);
    });
  });

  it("tokens vanish when they leave the battlefield", () => {
    const { table, env } = setup();
    applyTableAction(table, "a", { a: "token", token: { name: "Goblin", power: "1", toughness: "1", colors: ["R"] }, count: 2 }, env);
    const tokens = Object.values(table.cards).filter((c) => c.token);
    expect(tokens).toHaveLength(2);
    applyTableAction(table, "a", { a: "move", ids: [tokens[0].id], to: "graveyard" }, env);
    expect(table.cards[tokens[0].id]).toBeUndefined();
  });

  it("tracks life and turns", () => {
    const { table, env } = setup();
    applyTableAction(table, "a", { a: "life", playerId: "b", delta: -3 }, env);
    expect(table.players.b.life).toBe(17);
    applyTableAction(table, "a", { a: "nextTurn" }, env);
    expect(table.turn).toEqual({ playerId: "b", number: 1 });
    applyTableAction(table, "b", { a: "nextTurn" }, env);
    expect(table.turn).toEqual({ playerId: "a", number: 2 });
  });

  it("life and poison changes that change nothing are not logged", () => {
    const { table, env } = setup();
    const before = table.log.length;
    applyTableAction(table, "a", { a: "life", playerId: "a", delta: 0 }, env);
    // Poison can't go below zero, so removing one from none is also a no-op.
    applyTableAction(table, "a", { a: "poison", playerId: "a", delta: -1 }, env);
    expect(table.players.a).toMatchObject({ life: 20, poison: 0 });
    expect(table.log).toHaveLength(before);
    applyTableAction(table, "a", { a: "poison", playerId: "b", delta: 2 }, env);
    applyTableAction(table, "a", { a: "poison", playerId: "b", delta: -5 }, env);
    // The log shows the change that actually happened.
    expect(table.log.at(-1)?.text).toBe("Bob's poison: -2 → 0 (by Alice).");
  });

  it("marks players, cards, actions and results in log lines", () => {
    const { table, env } = setup();
    const spans = (e = table.log.at(-1)!) => (e.marks ?? []).map(([s, end, kind, ...rest]) => [e.text.slice(s, end), kind, ...rest]);
    const id = table.players.b.zones.hand[0];
    const cardId = table.cards[id].cardId!;
    const name = env.cards[cardId].name;
    applyTableAction(table, "b", { a: "move", ids: [id], to: "battlefield", x: 0, y: 0 }, env);
    applyTableAction(table, "a", { a: "tap", ids: [id] }, env);
    expect(table.log.at(-1)?.kind).toBe("tap");
    expect(spans()).toEqual([
      ["Alice", "p", "a"],
      ["tapped", "v"],
      ["Bob", "p", "b"],
      [name, "c", cardId],
    ]);
    applyTableAction(table, "a", { a: "life", playerId: "b", delta: -3 }, env);
    expect(table.log.at(-1)?.kind).toBe("life");
    expect(spans()).toEqual([
      ["Bob", "p", "b"],
      ["life", "v"],
      ["-3", "n", "bad"],
      ["17", "n"],
      ["Alice", "p", "a"],
    ]);
    applyTableAction(table, "a", { a: "poison", playerId: "b", delta: 1 }, env);
    expect(spans()[2]).toEqual(["+1", "n", "bad"]);
    applyTableAction(table, "a", { a: "move", ids: [id], to: "graveyard" }, env);
    expect(table.log.at(-1)?.kind).toBe("graveyard");
    expect(spans()).toContainEqual(["graveyard", "z"]);
    applyTableAction(table, "a", { a: "nextTurn" }, env);
    expect(table.log.at(-1)?.kind).toBe("turn");
    // Tokens made up on the spot have no card to link to, but are still marked as cards.
    applyTableAction(table, "a", { a: "token", token: { name: "Goblin", colors: ["R"] }, count: 2 }, env);
    expect(spans()).toContainEqual(["Goblin", "c"]);
    // The whole log survives the trip to clients unchanged (no gaps in the tuples turn into null).
    expect(JSON.parse(JSON.stringify(table.log))).toEqual(table.log);
  });

  it("never marks a hidden card with its identity", () => {
    const { table, env } = setup();
    const [a, b] = table.players.a.zones.hand;
    applyTableAction(table, "a", { a: "move", ids: [a], to: "battlefield", faceDown: true }, env);
    applyTableAction(table, "a", { a: "move", ids: [b], to: "library" }, env);
    applyTableAction(table, "a", { a: "move", ids: [a], to: "hand" }, env);
    for (const e of table.log.slice(-3)) {
      expect(e.marks?.some((m) => m[2] === "c")).toBe(false);
      expect(JSON.stringify(e)).not.toContain(table.cards[a].cardId!);
      expect(JSON.stringify(e)).not.toContain(table.cards[b].cardId!);
    }
  });

  it("marks the face a double-faced card showed", () => {
    const { table, env } = setup();
    const id = table.players.a.zones.hand[0];
    const data = env.cards[table.cards[id].cardId!];
    env.cards[data.id] = {
      ...data,
      faces: [
        { name: "Day Side", manaCost: "", typeLine: "Creature", oracleText: "", colors: ["G"], images: { normal: "day.jpg" } },
        { name: "Night Side", manaCost: "", typeLine: "Creature", oracleText: "", colors: ["G"], images: { normal: "night.jpg" } },
      ],
    };
    applyTableAction(table, "a", { a: "move", ids: [id], to: "battlefield", face: 1 }, env);
    const e = table.log.at(-1)!;
    const mark = e.marks!.find((m) => m[2] === "c")!;
    expect(e.text.slice(mark[0], mark[1])).toBe("Night Side");
    expect(mark.slice(3)).toEqual([data.id, 1]);
    // A token copy of the back face links to the back face too, whenever the log names it.
    applyTableAction(table, "a", { a: "clone", id }, env);
    const copy = Object.values(table.cards).find((c) => c.token && c.cardId === data.id)!;
    applyTableAction(table, "a", { a: "tap", ids: [copy.id] }, env);
    const tapped = table.log.at(-1)!;
    const tokenMark = tapped.marks!.find((m) => m[2] === "c")!;
    expect(tapped.text.slice(tokenMark[0], tokenMark[1])).toBe("Night Side");
    expect(tokenMark.slice(3)).toEqual([data.id, 1]);
  });

  it("refuses to copy a face-down card (the copy would reveal it)", () => {
    const { table, env } = setup();
    const id = table.players.b.zones.hand[0];
    applyTableAction(table, "b", { a: "move", ids: [id], to: "battlefield", faceDown: true }, env);
    const before = Object.keys(table.cards).length;
    expect(() => applyTableAction(table, "a", { a: "clone", id }, env)).toThrow(TableError);
    expect(() => applyTableAction(table, "b", { a: "clone", id }, env)).toThrow(TableError);
    expect(Object.keys(table.cards)).toHaveLength(before);
  });

  it("names the owner when someone acts on another player's card", () => {
    const { table, env } = setup();
    const id = table.players.b.zones.hand[0];
    applyTableAction(table, "b", { a: "move", ids: [id], to: "battlefield", x: 0, y: 0 }, env);
    const name = env.cards[table.cards[id].cardId!].name;
    applyTableAction(table, "a", { a: "tap", ids: [id] }, env);
    expect(table.log.at(-1)?.text).toBe(`Alice tapped Bob's ${name}.`);
    applyTableAction(table, "a", { a: "counter", id, kind: "+1/+1", delta: 1 }, env);
    expect(table.log.at(-1)?.text).toBe(`Alice added a +1/+1 counter to Bob's ${name} (1).`);
    applyTableAction(table, "a", { a: "flip", ids: [id] }, env);
    expect(table.log.at(-1)?.text).toBe("Alice turned Bob's card face down.");
    applyTableAction(table, "a", { a: "flip", ids: [id] }, env);
    applyTableAction(table, "a", { a: "move", ids: [id], to: "graveyard" }, env);
    expect(table.log.at(-1)?.text).toBe(`Alice moved Bob's ${name} from the battlefield to Bob's graveyard.`);
    // Their own cards read as before.
    const mine = table.players.a.zones.hand[0];
    applyTableAction(table, "a", { a: "move", ids: [mine], to: "battlefield", x: 0, y: 0 }, env);
    applyTableAction(table, "a", { a: "tap", ids: [mine] }, env);
    expect(table.log.at(-1)?.text).toBe(`Alice tapped ${env.cards[table.cards[mine].cardId!].name}.`);
  });

  it("double-faced cards can enter the battlefield on either face", () => {
    const { table, env } = setup();
    applyTableAction(table, "a", { a: "draw", n: 20 }, env);
    const hand = table.players.a.zones.hand;
    const cardOf = (id: string) => table.cards[id].cardId;
    const front = hand[0];
    const back = hand.find((id) => cardOf(id) !== cardOf(front))!;
    const plain = hand.find((id) => cardOf(id) !== cardOf(front) && cardOf(id) !== cardOf(back))!;
    for (const id of [front, back]) {
      const data = env.cards[table.cards[id].cardId!];
      env.cards[data.id] = {
        ...data,
        faces: [
          { name: "Day Side", manaCost: "{1}{G}", typeLine: "Creature", oracleText: "", colors: ["G"], images: { normal: "day.jpg" } },
          { name: "Night Side", manaCost: "", typeLine: "Creature", oracleText: "", colors: ["G"], images: { normal: "night.jpg" } },
        ],
      };
    }
    applyTableAction(table, "a", { a: "move", ids: [back], to: "battlefield", face: 1 }, env);
    expect(table.cards[back].face).toBe(1);
    expect(table.log.at(-1)?.text).toMatch(/Night Side/);
    applyTableAction(table, "a", { a: "move", ids: [front], to: "battlefield" }, env);
    expect(table.cards[front].face).toBe(0);
    // Out-of-range faces (and single-faced cards) are ignored rather than trusted.
    applyTableAction(table, "a", { a: "move", ids: [plain], to: "battlefield", face: 1 }, env);
    expect(table.cards[plain].face).toBe(0);
    // Leaving the battlefield turns it back to the front.
    applyTableAction(table, "a", { a: "move", ids: [back], to: "hand" }, env);
    expect(table.cards[back].face).toBe(0);
  });
});

describe("table card ids", () => {
  const ID = /^k[A-Z2-9]{10}$/;

  /** Two drafted decks with draft-style instance ids ("c…"), a foil, a sideboard, and basics. */
  function draftedTable() {
    let n = 0;
    const env: TableEnv = { cards: makeCube(100), rng: mulberry32(7), now: 0, nextId: (p) => `${p}${(n++).toString(36)}`, names: { a: "Alice", b: "Bob" } };
    const instances: Record<string, CardInstance> = {};
    let next = 1;
    const deck = (first: number): DeckState => {
      const iids = Array.from({ length: 30 }, (_, i) => {
        const iid = `c${(next++).toString(36)}`;
        instances[iid] = { iid, cardId: `card-${first + i}`, ...(i === 0 ? { foil: true } : {}) };
        return iid;
      });
      return { main: iids.slice(0, 23), side: iids.slice(23), basics: { W: 9, U: 8, B: 0, R: 0, G: 0, C: 0 }, ready: true };
    };
    const decks = { a: deck(0), b: deck(30) };
    const table = createTable(["a", "b"], decks, instances, basicIds, { startingLife: 20, openingHandSize: 7 }, env);
    return { table, env, instances, decks };
  }

  it("never reuses a draft instance id", () => {
    const { table, instances } = draftedTable();
    const ids = Object.keys(table.cards);
    expect(ids).toHaveLength(2 * (30 + 17));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(instances[id]).toBeUndefined();
  });

  it("gives basic lands the same kind of id as every other card", () => {
    const { table } = draftedTable();
    const cards = Object.values(table.cards);
    const basics = cards.filter((c) => c.cardId?.startsWith("basic-"));
    expect(basics).toHaveLength(2 * 17);
    for (const c of cards) expect(c.id).toMatch(ID);
  });

  it("orders the card map by id, not by decklist with basics last", () => {
    const { table } = draftedTable();
    const ids = Object.keys(table.cards);
    expect(ids).toEqual(ids.slice().sort());
    const basicAt = ids.map((id, i) => (table.cards[id].cardId?.startsWith("basic-") ? i : -1)).filter((i) => i >= 0);
    expect(Math.min(...basicAt)).toBeLessThan(ids.length / 2);
  });

  it("keeps each drafted card's foil on its table card", () => {
    const { table, instances, decks } = draftedTable();
    const foils = Object.values(table.cards).filter((c) => c.foil);
    expect(foils.map((c) => c.cardId).sort()).toEqual([instances[decks.a.main[0]].cardId, instances[decks.b.main[0]].cardId].sort());
  });

  it("shows another player's hidden cards as identical blanks", () => {
    const { table, env, instances } = draftedTable();
    // One of Alice's cards goes onto the battlefield face down.
    const faceDown = table.players.a.zones.hand[0];
    applyTableAction(table, "a", { a: "move", ids: [faceDown], to: "battlefield", x: 1, y: 2, faceDown: true }, env);

    const view: typeof table = JSON.parse(JSON.stringify(tableViewFor(table, "b")));
    const theirs = Object.values(view.cards).filter((c) => c.owner === "a");
    expect(theirs).toHaveLength(47);
    for (const c of theirs) {
      expect(c.id).toMatch(ID);
      const { id, x, y, z, faceDown: down, zone, ...rest } = c;
      expect(rest).toEqual({ owner: "a", controller: "a", tapped: false, face: 0, counters: {}, hidden: true });
      if (id !== faceDown) expect({ x, y, z, faceDown: down }).toEqual({ x: 0, y: 0, z: 0, faceDown: false });
      expect(zone).toBe(id === faceDown ? "battlefield" : table.cards[id].zone);
    }
    // Nothing in Bob's view names Alice's draft ids or cards.
    const json = JSON.stringify(view);
    for (const [iid, inst] of Object.entries(instances)) {
      if (Number.parseInt(inst.cardId.slice(5)) >= 30) continue; // Bob's own
      expect(json).not.toContain(`"${iid}"`);
      expect(json).not.toContain(`"${inst.cardId}"`);
    }
  });
});

describe("seat order from a player's point of view", () => {
  it("starts at your seat and wraps around the table", () => {
    expect(seatsFromMe(["a", "b", "c", "d"], "a")).toEqual(["a", "b", "c", "d"]);
    expect(seatsFromMe(["a", "b", "c", "d"], "c")).toEqual(["c", "d", "a", "b"]);
    expect(seatsFromMe(["a", "b", "c", "d"], "d")).toEqual(["d", "a", "b", "c"]);
  });

  it("keeps table order for someone who isn't seated", () => {
    const seats = ["a", "b"];
    const out = seatsFromMe(seats, "zz");
    expect(out).toEqual(["a", "b"]);
    expect(out).not.toBe(seats);
  });
});
