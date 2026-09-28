import { describe, expect, it } from "vitest";
import { applyTableAction, createTable, TableError, tableViewFor, type TableEnv } from "../src/shared/table";
import { seatsFromMe } from "../src/shared/tableLayout";
import { mulberry32 } from "../src/shared/rng";
import type { DeckState } from "../src/shared/types";
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
