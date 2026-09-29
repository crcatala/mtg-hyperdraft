import { describe, expect, it } from "vitest";
import { guardFor, guardForAll, type GuardContext } from "../src/client/table/guards";
import type { TableCard, TableState } from "../src/shared/types";

function card(id: string, owner: string, zone: TableCard["zone"] = "battlefield", controller = owner): TableCard {
  return { id, owner, controller, zone, x: 0, y: 0, tapped: false, faceDown: false, face: 0, counters: {}, z: 0 };
}

function ctx(turn = "a", cards: TableCard[] = []): GuardContext {
  const player = (seat: number) => ({ seat, life: 20, poison: 0, zones: { hand: [], library: [], graveyard: [], exile: [], sideboard: [] } });
  const table = {
    seats: ["a", "b", "c", "d"],
    players: { a: player(0), b: player(1), c: player(2), d: player(3) },
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    turn: { playerId: turn, number: 1 },
    nextZ: 0,
    log: [],
    peek: {},
    openingHandSize: 7,
  } as unknown as TableState;
  const names: Record<string, string> = { a: "Alice", b: "Bob", c: "Cleo", d: "Dave" };
  return { table, me: "a", nameOf: (id) => names[id], cardLabel: (c) => `Card ${c.id}` };
}

describe("off-turn guards", () => {
  it("asks before turn-structure actions on someone else's turn", () => {
    const off = ctx("b");
    const draw = guardFor({ a: "draw", n: 1 }, off);
    expect(draw).toMatchObject({ question: "It's Bob's turn. Draw a card anyway?", confirm: "Draw" });
    expect(draw?.parts).toContainEqual({ text: "Bob", kind: "player", playerId: "b" });
    expect(guardFor({ a: "draw", n: 3 }, off)?.question).toBe("It's Bob's turn. Draw 3 cards anyway?");
    const endTurn = guardFor({ a: "nextTurn" }, off);
    expect(endTurn).toMatchObject({ question: "It's Bob's turn, not yours. End it anyway?", confirm: "End their turn" });
    expect(endTurn?.parts).toContainEqual({ text: "Bob", kind: "player", playerId: "b" });
    for (const a of [{ a: "untapAll" }, { a: "shuffle" }, { a: "mill", n: 2 }] as const) expect(guardFor(a, off)).not.toBeNull();
  });

  it("lets the same actions through on your own turn", () => {
    const mine = ctx("a");
    for (const a of [{ a: "draw", n: 1 }, { a: "nextTurn" }, { a: "untapAll" }, { a: "shuffle" }, { a: "mill", n: 1 }] as const) expect(guardFor(a, mine)).toBeNull();
  });

  it("never guards instant-speed things off-turn", () => {
    const off = ctx("b", [card("x", "a")]);
    expect(guardFor({ a: "tap", ids: ["x"], tapped: true }, off)).toBeNull();
    expect(guardFor({ a: "life", playerId: "a", delta: -2 }, off)).toBeNull();
    expect(guardFor({ a: "roll", sides: 20 }, off)).toBeNull();
  });

  it("always confirms a mulligan, once", () => {
    expect(guardFor({ a: "mulligan" }, ctx("a"))?.confirm).toBe("Mulligan");
    expect(guardFor({ a: "mulligan" }, ctx("b"))?.question).toBe("Shuffle your hand into your library and draw a new hand?");
  });
});

describe("other players' cards", () => {
  const cards = [card("mine", "a"), card("bob1", "b"), card("bob2", "b"), card("cleo", "c"), card("stolen", "b", "battlefield", "a"), card("bobGy", "b", "graveyard")];

  it("asks before touching a card someone else controls", () => {
    const c = ctx("a", cards);
    const tap = guardFor({ a: "tap", ids: ["bob1"], tapped: true }, c);
    expect(tap).toMatchObject({ question: "Card bob1 belongs to Bob. Tap it anyway?", confirm: "Tap" });
    expect(tap?.parts).toContainEqual({ text: "Bob", kind: "player", playerId: "b" });
    expect(tap?.parts?.[0]).toMatchObject({ text: "Card bob1", kind: "card" });
    expect(guardFor({ a: "tap", ids: ["bob1"], tapped: false }, c)?.confirm).toBe("Untap");
    expect(guardFor({ a: "flip", ids: ["bob1"] }, c)?.question).toBe("Card bob1 belongs to Bob. Turn it over anyway?");
    expect(guardFor({ a: "counter", id: "bob1", kind: "+1/+1", delta: -1 }, c)?.question).toBe("Card bob1 belongs to Bob. Remove a +1/+1 counter from it anyway?");
    expect(guardFor({ a: "move", ids: ["bob1"], to: "exile" }, c)?.question).toBe("Card bob1 belongs to Bob. Exile it anyway?");
    expect(guardFor({ a: "setPos", id: "bob1", x: 1, y: 1 }, c)?.confirm).toBe("Move");
  });

  it("includes visible card data for hover previews without exposing hidden identities", () => {
    const visible = { ...card("bob1", "b"), cardId: "scryfall-card", face: 1 };
    const prompt = guardFor({ a: "tap", ids: ["bob1"] }, ctx("a", [visible]));
    expect(prompt?.parts?.[0]).toMatchObject({ kind: "card", cardId: "scryfall-card", face: 1 });

    const hidden = { ...visible, hidden: true };
    expect(guardFor({ a: "tap", ids: ["bob1"] }, ctx("a", [hidden]))?.parts?.[0]).toMatchObject({ kind: "card", cardId: undefined });
  });

  it("goes by controller on the battlefield and owner elsewhere", () => {
    const c = ctx("a", cards);
    // Bob owns it, but Alice controls it now.
    expect(guardFor({ a: "tap", ids: ["stolen"] }, c)).toBeNull();
    expect(guardFor({ a: "move", ids: ["bobGy"], to: "battlefield" }, c)?.question).toBe("Card bobGy belongs to Bob. Put it onto the battlefield anyway?");
    expect(guardFor({ a: "tap", ids: ["mine"] }, c)).toBeNull();
    expect(guardFor({ a: "clone", id: "bob1" }, c)).toBeNull();
  });

  it("counts foreign cards in a mixed selection and names every owner", () => {
    const c = ctx("a", cards);
    const prompt = guardFor({ a: "tap", ids: ["mine", "bob1", "cleo"] }, c);
    expect(prompt?.question).toBe("2 of these 3 cards belong to Bob and Cleo. Tap them anyway?");
    expect(prompt?.parts).toContainEqual({ text: "Bob", kind: "player", playerId: "b" });
    expect(prompt?.parts).toContainEqual({ text: "Cleo", kind: "player", playerId: "c" });
  });

  it("formats three distinct owners with a comma and final conjunction", () => {
    const prompt = guardFor({ a: "tap", ids: ["bob1", "cleo", "dave"] }, ctx("a", [...cards, card("dave", "d")]));
    expect(prompt?.question).toBe("3 of these 3 cards belong to Bob, Cleo and Dave. Tap them anyway?");
    expect(prompt?.parts?.map((part) => part.text).join("")).toBe(prompt?.question);
    expect(prompt?.parts).toContainEqual({ text: "Bob", kind: "player", playerId: "b" });
    expect(prompt?.parts).toContainEqual({ text: "Cleo", kind: "player", playerId: "c" });
    expect(prompt?.parts).toContainEqual({ text: "Dave", kind: "player", playerId: "d" });
  });

  it("judges a dropped group of cards as one move", () => {
    const c = ctx("a", cards);
    const drop = ["mine", "bob1", "bob2"].map((id) => ({ id, x: 0, y: 0 }));
    expect(guardFor({ a: "place", cards: drop }, c)?.question).toBe("2 of these 3 cards belong to Bob. Move them anyway?");
    expect(guardFor({ a: "place", cards: [{ id: "mine", x: 0, y: 0 }] }, c)).toBeNull();
  });

  it("off-turn questions come first when an action is both", () => {
    expect(guardForAll([{ a: "move", ids: ["mine"], to: "library" }, { a: "shuffle" }], ctx("b", cards))?.confirm).toBe("Shuffle");
  });
});
