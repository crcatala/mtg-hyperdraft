import { describe, expect, it } from "vitest";
import { createRoomState, EMOTE_COOLDOWN_MS, PING_COOLDOWN_MS, POKE_COOLDOWN_MS, Room, SeatClaimNeeded, type ImportResult } from "../src/shared/room";
import { basicIds, makeCube, testDeps } from "./fixtures";
import type { ClientMessage } from "../src/shared/protocol";
import { EMOTE_TEXT_MAX } from "../src/shared/emoteText";
import { matCenter, tableRadius } from "../src/shared/tableLayout";

function importResult(n = 400): ImportResult {
  const cards = Object.values(makeCube(n));
  return { name: "Test Cube", source: "test", cards, pool: cards.filter((c) => !c.id.startsWith("basic")).map((c) => c.id), notFound: [], warnings: [], basics: basicIds };
}

function newRoom() {
  const deps = testDeps();
  const room = new Room(createRoomState("ABCDEF", deps.now()), {}, deps);
  return { room, deps };
}

const send = (room: Room, pid: string, msg: ClientMessage) => room.handle(pid, msg);

describe("room flow", () => {
  it("runs lobby → draft → deckbuilding → playing with a human and bots", () => {
    const { room } = newRoom();
    const host = room.join({ name: "Alice" });
    expect(room.state.players[0].isHost).toBe(true);

    expect(send(room, host.playerId, { t: "import", source: "x" }).importSource).toBe("x");
    room.applyImport(importResult());
    send(room, host.playerId, { t: "addBot" });
    send(room, host.playerId, { t: "addBot" });
    send(room, host.playerId, { t: "setReady", ready: true });
    expect(room.state.phase).toBe("drafting");

    // Human drafts by always taking the first card.
    for (let i = 0; i < 45; i++) {
      const view = room.viewFor(host.playerId);
      expect(view.draft?.pack).toBeTruthy();
      const res = send(room, host.playerId, { t: "pick", packId: view.draft!.pack!.id, picks: [view.draft!.pack!.cards[0]], burns: [] });
      expect(res.outbound).toEqual([]);
    }
    expect(room.state.phase).toBe("deckbuilding");
    const view = room.viewFor(host.playerId);
    expect(view.deck?.side).toHaveLength(45);

    // Not enough cards yet.
    const err = send(room, host.playerId, { t: "deckReady", ready: true });
    expect(err.outbound[0].msg).toMatchObject({ t: "error" });

    const deck = view.deck!;
    send(room, host.playerId, { t: "deck", main: deck.side.slice(0, 23), side: deck.side.slice(23), basics: { W: 17, U: 0, B: 0, R: 0, G: 0, C: 0 } });
    send(room, host.playerId, { t: "deckReady", ready: true });
    expect(room.state.phase).toBe("playing");
    const table = room.viewFor(host.playerId).table!;
    expect(table.seats).toEqual([host.playerId]);
    expect(table.players[host.playerId].zones.hand).toHaveLength(7);
  });

  it("waits for every human to be ready and resets ready on config changes", () => {
    const { room } = newRoom();
    const a = room.join({ name: "A" });
    const b = room.join({ name: "B" });
    room.applyImport(importResult());
    send(room, a.playerId, { t: "setReady", ready: true });
    expect(room.state.phase).toBe("lobby");
    send(room, a.playerId, { t: "config", draft: { cardsPerPack: 14 } });
    expect(room.state.players.every((p) => !p.ready)).toBe(true);
    const err = send(room, b.playerId, { t: "config", draft: { cardsPerPack: 10 } });
    expect(err.outbound[0].msg).toMatchObject({ t: "error", message: "Only the host can do that." });
    send(room, a.playerId, { t: "setReady", ready: true });
    send(room, b.playerId, { t: "setReady", ready: true });
    expect(room.state.phase).toBe("drafting");
    expect(room.viewFor(a.playerId).draft?.pack?.cards).toHaveLength(14);
  });

  it("does not start when the pool is too small", () => {
    const { room } = newRoom();
    const a = room.join({});
    room.applyImport(importResult(30));
    send(room, a.playerId, { t: "setReady", ready: true });
    expect(room.state.phase).toBe("lobby");
    expect(room.startBlocker()).toMatch(/Need 45/);
  });

  it("reconnects with the secret and rejects new players mid-game", () => {
    const { room } = newRoom();
    const a = room.join({ name: "A" });
    room.setConnected(a.playerId, false);
    expect(room.join({ playerId: a.playerId, secret: a.secret }).playerId).toBe(a.playerId);
    room.applyImport(importResult());
    send(room, a.playerId, { t: "setReady", ready: true });
    expect(() => room.join({ name: "Late" })).toThrow(/already started/);
    expect(() => room.join({ playerId: a.playerId, secret: "wrong" })).toThrow(/already started/);
  });

  it("auto-picks on timer expiry via tick", () => {
    const { room, deps } = newRoom();
    const a = room.join({});
    room.join({});
    room.applyImport(importResult());
    send(room, a.playerId, { t: "config", draft: { pickTimerSec: 20 } });
    for (const p of room.state.players) send(room, p.id, { t: "setReady", ready: true });
    expect(room.nextAlarm()).toBe(deps.now() + 20_000);
    deps.advance(20_000);
    expect(room.tick()).toBe(true);
    expect(room.state.draft!.picks[a.playerId]).toHaveLength(1);
  });

  it("debug startGame jumps straight to the table with auto-built decks", () => {
    const { room } = newRoom();
    const a = room.join({});
    room.applyImport(importResult());
    send(room, a.playerId, { t: "addBot" });
    send(room, a.playerId, { t: "debug", cmd: "startGame" });
    expect(room.state.phase).toBe("playing");
    const table = room.viewFor(a.playerId).table!;
    expect(Object.values(table.cards).filter((c) => c.owner === a.playerId && c.zone !== "sideboard")).toHaveLength(40);
  });

  it("gives table cards fresh ids that no drafter saw and that hide basics from opponents", () => {
    const { room } = newRoom();
    const a = room.join({ name: "Alice" });
    const b = room.join({ name: "Bob" });
    room.applyImport(importResult());
    send(room, a.playerId, { t: "debug", cmd: "startGame" });
    expect(room.state.phase).toBe("playing");

    const draftIds = Object.keys(room.state.instances);
    expect(draftIds.length).toBeGreaterThan(0);
    const table = room.state.table!;
    for (const id of Object.keys(table.cards)) {
      expect(room.state.instances[id]).toBeUndefined();
      expect(id).toMatch(/^k[A-Z2-9]{10}$/);
    }
    expect(Object.values(table.cards).some((c) => c.cardId?.startsWith("basic-"))).toBe(true);

    // Bob's view names none of the draft ids, and Alice's hidden cards are all alike.
    const view = room.viewFor(b.playerId);
    const json = JSON.stringify(view.table);
    for (const iid of draftIds) expect(json).not.toContain(`"${iid}"`);
    const hers = Object.values(view.table!.cards).filter((c) => c.owner === a.playerId);
    expect(hers.length).toBeGreaterThan(40);
    expect(new Set(hers.map(({ id: _, zone: __, ...rest }) => JSON.stringify(rest))).size).toBe(1);
    expect(hers.every((c) => c.hidden && c.cardId === undefined && !c.foil)).toBe(true);
  });

  it("hides the host secret and other packs from views", () => {
    const { room } = newRoom();
    const a = room.join({});
    const view = room.viewFor(a.playerId);
    expect(JSON.stringify(view)).not.toContain(a.secret);
  });

  it("keeps the invite id out of player views", () => {
    const deps = testDeps();
    const room = new Room(createRoomState("ABCDEFG", deps.now(), { inviteId: "sam" }), {}, deps);
    const a = room.join({});
    expect(room.state.inviteId).toBe("sam");
    expect(JSON.stringify(room.viewFor(a.playerId))).not.toContain("sam");
  });

  it("summarizes the room for the invite ledger", () => {
    const { room } = newRoom();
    const a = room.join({ name: "Alice" });
    room.join({ name: "Bob" });
    send(room, a.playerId, { t: "addBot" });
    expect(room.summary()).toEqual({ phase: "lobby", players: ["Alice", "Bob"], bots: 1, cubeName: null, cardCount: 0 });
    room.applyImport(importResult(300));
    expect(room.summary()).toMatchObject({ cubeName: "Test Cube", cardCount: 300 });
  });

  it("replaces card data when a new cube is imported", () => {
    const { room } = newRoom();
    room.join({});
    room.applyImport(importResult(300));
    room.applyImport({ ...importResult(50), name: "Small" });
    expect(Object.keys(room.cards)).toHaveLength(50 + 6);
  });
  it("relays table pings to the other players, throttled per player", () => {
    const { room, deps } = newRoom();
    const a = room.join({ name: "Alice" });
    const b = room.join({ name: "Bob" });
    // Pings only mean something on the table.
    expect(send(room, a.playerId, { t: "point", x: 1, y: 2 }).outbound).toEqual([]);

    room.applyImport(importResult());
    send(room, a.playerId, { t: "debug", cmd: "startGame" });
    expect(room.state.phase).toBe("playing");

    const res = send(room, a.playerId, { t: "point", x: 1, y: 2 });
    expect(res.changed).toBe(false);
    expect(res.outbound).toEqual([{ to: "others", msg: { t: "point", by: a.playerId, x: 1, y: 2 } }]);
    // Spam inside the cooldown is dropped; another player has their own cooldown.
    expect(send(room, a.playerId, { t: "point", x: 3, y: 4 }).outbound).toEqual([]);
    expect(send(room, b.playerId, { t: "point", x: 3, y: 4 }).outbound).toHaveLength(1);
    deps.advance(PING_COOLDOWN_MS);
    expect(send(room, a.playerId, { t: "point", x: 5, y: 6 }).outbound).toHaveLength(1);
  });

  it("relays companion pokes to the other players, stamped with the sender, never stored", () => {
    const { room, deps } = newRoom();
    const a = room.join({ name: "Alice", companion: "hex" });
    const b = room.join({ name: "Bob", companion: "gloop" });
    const c = room.join({ name: "Cara" }); // no companion
    send(room, a.playerId, { t: "addBot" });
    // Only at the table.
    expect(send(room, a.playerId, { t: "poke", target: b.playerId, step: 0 }).outbound).toEqual([]);

    room.applyImport(importResult());
    send(room, a.playerId, { t: "debug", cmd: "startGame" });
    expect(room.state.phase).toBe("playing");
    const before = JSON.stringify(room.state);

    const res = send(room, a.playerId, { t: "poke", target: b.playerId, step: 2 });
    expect(res.changed).toBe(false);
    expect(res.outbound).toEqual([{ to: "others", msg: { t: "poke", by: a.playerId, target: b.playerId, step: 2 } }]);
    // `by` is always the sender's own id (there is no way to send one).
    deps.advance(POKE_COOLDOWN_MS);
    expect(send(room, b.playerId, { t: "poke", target: b.playerId, step: 0 }).outbound).toEqual([{ to: "others", msg: { t: "poke", by: b.playerId, target: b.playerId, step: 0 } }]);

    // Dropped: unknown targets, players without a companion, bots (never seated at the table).
    deps.advance(POKE_COOLDOWN_MS);
    const bot = room.state.players.find((p) => p.isBot)!;
    expect(bot.companion).toBeTruthy();
    expect(room.state.table!.seats).not.toContain(bot.id);
    for (const target of ["nobody", c.playerId, bot.id]) expect(send(room, a.playerId, { t: "poke", target, step: 0 }).outbound).toEqual([]);

    // Spam inside the cooldown is dropped; each player has their own.
    expect(send(room, a.playerId, { t: "poke", target: b.playerId, step: 3 }).outbound).toHaveLength(1);
    expect(send(room, a.playerId, { t: "poke", target: b.playerId, step: 4 }).outbound).toEqual([]);
    expect(send(room, c.playerId, { t: "poke", target: a.playerId, step: 0 }).outbound).toHaveLength(1);
    deps.advance(POKE_COOLDOWN_MS);
    expect(send(room, a.playerId, { t: "poke", target: b.playerId, step: 4 }).outbound).toHaveLength(1);

    // Nothing about pokes is kept in the room.
    expect(JSON.stringify(room.state)).toBe(before);
  });

  it("relays emotes on the sender's own companion to the other players, with a per-player cooldown, never stored", () => {
    const { room, deps } = newRoom();
    const a = room.join({ name: "Alice", companion: "hex" });
    const b = room.join({ name: "Bob", companion: "gloop" });
    const c = room.join({ name: "Cara" }); // no companion
    // Only at the table.
    expect(send(room, a.playerId, { t: "emote", slot: 0 }).outbound).toEqual([]);

    room.applyImport(importResult());
    send(room, a.playerId, { t: "debug", cmd: "startGame" });
    expect(room.state.phase).toBe("playing");
    const before = JSON.stringify(room.state);

    const res = send(room, a.playerId, { t: "emote", slot: 5 });
    expect(res.changed).toBe(false);
    expect(res.outbound).toEqual([{ to: "others", msg: { t: "emote", by: a.playerId, slot: 5 } }]);
    // A sender with no companion has nothing to emote with.
    expect(send(room, c.playerId, { t: "emote", slot: 0 }).outbound).toEqual([]);

    // Spam inside the cooldown is dropped; each player has their own.
    expect(send(room, a.playerId, { t: "emote", slot: 1 }).outbound).toEqual([]);
    expect(send(room, b.playerId, { t: "emote", slot: 1 }).outbound).toEqual([{ to: "others", msg: { t: "emote", by: b.playerId, slot: 1 } }]);
    deps.advance(EMOTE_COOLDOWN_MS - 1);
    expect(send(room, a.playerId, { t: "emote", slot: 1 }).outbound).toEqual([]);
    deps.advance(1);
    expect(send(room, a.playerId, { t: "emote", slot: 1 }).outbound).toHaveLength(1);

    // Nothing about emotes is kept in the room.
    expect(JSON.stringify(room.state)).toBe(before);
  });

  it("relays a player's own emote line cleaned, and drops one that doesn't clean up without using the cooldown", () => {
    const { room, deps } = newRoom();
    const a = room.join({ name: "Alice", companion: "hex" });
    room.join({ name: "Bob", companion: "gloop" });
    room.applyImport(importResult());
    send(room, a.playerId, { t: "debug", cmd: "startGame" });
    const before = JSON.stringify(room.state);

    // Nothing left after cleaning, or too long: dropped, and the cooldown isn't spent on it.
    expect(send(room, a.playerId, { t: "emote", slot: 0, text: " \n\u200B\t " }).outbound).toEqual([]);
    expect(send(room, a.playerId, { t: "emote", slot: 0, text: "x".repeat(EMOTE_TEXT_MAX + 1) }).outbound).toEqual([]);
    // Cleaned (whitespace squeezed, the bidi override gone), markup left exactly as typed, and stamped with the sender.
    const res = send(room, a.playerId, { t: "emote", slot: 5, by: "spoofed", text: "  <img src=x onerror=alert(1)>\n\u202Egotcha " } as ClientMessage);
    expect(res.changed).toBe(false);
    expect(res.outbound).toEqual([{ to: "others", msg: { t: "emote", by: a.playerId, slot: 5, text: "<img src=x onerror=alert(1)> gotcha" } }]);
    // The same cooldown as any emote.
    expect(send(room, a.playerId, { t: "emote", slot: 1, text: "again" }).outbound).toEqual([]);
    deps.advance(EMOTE_COOLDOWN_MS);
    expect(send(room, a.playerId, { t: "emote", slot: 1, text: "x".repeat(EMOTE_TEXT_MAX) }).outbound).toEqual([
      { to: "others", msg: { t: "emote", by: a.playerId, slot: 1, text: "x".repeat(EMOTE_TEXT_MAX) } },
    ]);

    // Never stored.
    expect(JSON.stringify(room.state)).toBe(before);
    expect(JSON.stringify(room.state)).not.toContain("gotcha");
  });
});

describe("carrying companions around the table", () => {
  function game() {
    const { room, deps } = newRoom();
    const a = room.join({ name: "Alice", companion: "hex" });
    const b = room.join({ name: "Bob", companion: "gloop" });
    const c = room.join({ name: "Cara" }); // no companion
    room.applyImport(importResult());
    send(room, a.playerId, { t: "debug", cmd: "startGame" });
    expect(room.state.phase).toBe("playing");
    expect(room.state.table!.seats).toHaveLength(3);
    return { room, deps, a, b, c };
  }
  const me = (room: Room, pid: string) => room.state.players.find((p) => p.id === pid)!;
  // Open table in the middle (three seats leave it free of mats), and the middle of Bob's mat.
  const OPEN = { x: 0.123, y: -0.456 };
  const onMat = (room: Room) => matCenter(room.state.table!.seats.indexOf(room.state.players[1].id), 3);

  it("relays the carry (moves, a cancelled drop) to the others, stamped with the sender, never stored", () => {
    const { room, a, c } = game();
    const before = JSON.stringify(room.state);
    const move = send(room, a.playerId, { t: "petMove", x: 3, y: -40, by: "spoofed" } as ClientMessage);
    expect(move.changed).toBe(false);
    expect(move.outbound).toEqual([{ to: "others", msg: { t: "petMove", by: a.playerId, x: 3, y: -40 } }]);
    expect(send(room, a.playerId, { t: "petCancel" }).outbound).toEqual([{ to: "others", msg: { t: "petCancel", by: a.playerId } }]);
    // No companion: nothing to carry.
    expect(send(room, c.playerId, { t: "petMove", x: 0, y: 0 }).outbound).toEqual([]);
    expect(send(room, c.playerId, { t: "petCancel" }).outbound).toEqual([]);
    expect(JSON.stringify(room.state)).toBe(before);
  });

  it("stores a valid drop on the sender's own companion only, and tells the others it landed", () => {
    const { room, a, b } = game();
    const res = send(room, a.playerId, { t: "setPetPos", at: OPEN });
    expect(res.changed).toBe(true);
    expect(res.outbound).toEqual([{ to: "others", msg: { t: "petLand", by: a.playerId, at: { x: 0.12, y: -0.46 } } }]);
    expect(me(room, a.playerId).companionAt).toEqual({ x: 0.12, y: -0.46 });
    // Nobody else's moved (there's no way to name another player's companion).
    expect(me(room, b.playerId).companionAt).toBeUndefined();
    // Reloads and late joiners see it in the view.
    expect(room.viewFor(b.playerId).players.find((p) => p.id === a.playerId)?.companionAt).toEqual({ x: 0.12, y: -0.46 });
  });

  it("rejects a drop on any mat, off the table, or with no companion, changing nothing", () => {
    const { room, a, c } = game();
    send(room, a.playerId, { t: "setPetPos", at: OPEN });
    const before = JSON.stringify(room.state);
    for (const at of [onMat(room), matCenter(0, 3), { x: 0, y: tableRadius(3) + 2 }, { x: 150, y: 150 }]) {
      const res = send(room, a.playerId, { t: "setPetPos", at });
      expect(res.changed).toBe(false);
      expect(res.outbound).toEqual([{ to: "self", msg: { t: "error", message: "Your companion can't stand there." } }]);
    }
    const none = send(room, c.playerId, { t: "setPetPos", at: OPEN });
    expect(none.changed).toBe(false);
    expect(none.outbound[0]).toMatchObject({ to: "self", msg: { t: "error" } });
    expect(JSON.stringify(room.state)).toBe(before);
  });

  it("only takes a drop at the table", () => {
    const { room } = newRoom();
    const a = room.join({ name: "Alice", companion: "hex" });
    const res = send(room, a.playerId, { t: "setPetPos", at: { x: 0, y: -6 } });
    expect(res.changed).toBe(false);
    expect(me(room, a.playerId).companionAt).toBeUndefined();
    expect(send(room, a.playerId, { t: "petMove", x: 0, y: 0 }).outbound).toEqual([]);
  });

  it("sends it home (null) with one write, and does nothing if it's home already", () => {
    const { room, a } = game();
    expect(send(room, a.playerId, { t: "setPetPos", at: null })).toEqual({ changed: false, outbound: [] });
    send(room, a.playerId, { t: "setPetPos", at: OPEN });
    const res = send(room, a.playerId, { t: "setPetPos", at: null });
    expect(res.changed).toBe(true);
    expect(res.outbound).toEqual([{ to: "others", msg: { t: "petLand", by: a.playerId, at: null } }]);
    expect(me(room, a.playerId).companionAt).toBeUndefined();
  });

  it("clears the spot for a new game, back in the lobby, and on a new companion", () => {
    const { room, a, b } = game();
    send(room, a.playerId, { t: "setPetPos", at: OPEN });
    send(room, b.playerId, { t: "setPetPos", at: { x: -1, y: 1 } });
    // Back to the lobby (and so to a new game): both go home.
    send(room, a.playerId, { t: "debug", cmd: "toLobby" });
    expect(room.state.players.map((p) => p.companionAt)).toEqual([undefined, undefined, undefined]);

    // A spot left over from an earlier game (say, a room saved mid-game) doesn't survive a new one.
    me(room, a.playerId).companionAt = { x: 1, y: 1 };
    send(room, a.playerId, { t: "debug", cmd: "startGame" });
    expect(me(room, a.playerId).companionAt).toBeUndefined();

    // Changing companion (in the lobby) starts the new one at home; changing only the avatar keeps it.
    send(room, a.playerId, { t: "debug", cmd: "toLobby" });
    me(room, a.playerId).companionAt = { x: 1, y: 1 };
    send(room, a.playerId, { t: "setLook", avatar: null });
    expect(me(room, a.playerId).companionAt).toEqual({ x: 1, y: 1 });
    send(room, a.playerId, { t: "setLook", companion: "hex" });
    expect(me(room, a.playerId).companionAt).toEqual({ x: 1, y: 1 });
    send(room, a.playerId, { t: "setLook", companion: "gloop" });
    expect(me(room, a.playerId).companionAt).toBeUndefined();
  });
});

describe("stand-in ids at the table", () => {
  function twoPlayerGame() {
    const { room, deps } = newRoom();
    const a = room.join({ name: "Alice" });
    const b = room.join({ name: "Bob" });
    room.applyImport(importResult());
    send(room, a.playerId, { t: "debug", cmd: "startGame" });
    return { room, deps, a: a.playerId, b: b.playerId };
  }

  it("takes actions on someone's face-down card by the stand-in the actor sees", () => {
    const { room, a, b } = twoPlayerGame();
    const id = room.state.table!.players[a].zones.hand[0];
    send(room, a, { t: "table", action: { a: "move", ids: [id], to: "battlefield", x: 0, y: 0, faceDown: true } });
    const standIn = Object.values(room.viewFor(b).table!.cards).find((c) => c.zone === "battlefield")!.id;
    expect(standIn).not.toBe(id);
    expect(send(room, b, { t: "table", action: { a: "tap", ids: [standIn] } }).changed).toBe(true);
    expect(room.state.table!.cards[id].tapped).toBe(true);
    // Its real id means nothing to Bob.
    expect(send(room, b, { t: "table", action: { a: "tap", ids: [id] } }).outbound).toEqual([{ to: "self", msg: { t: "error", message: "That card is gone." } }]);
    expect(room.state.table!.cards[id].tapped).toBe(true);
  });

  it("relays drags under each player's own id, and hand cards (only your own) under none", () => {
    const { room, a, b } = twoPlayerGame();
    const [down, handCard] = room.state.table!.players[a].zones.hand;
    send(room, a, { t: "table", action: { a: "move", ids: [down], to: "battlefield", x: 0, y: 0, faceDown: true } });
    const bobsId = Object.values(room.viewFor(b).table!.cards).find((c) => c.zone === "battlefield")!.id;
    expect(send(room, a, { t: "drag", id: down, x: 1, y: 2 }).outbound).toEqual([{ to: "player", playerId: b, msg: { t: "drag", by: a, id: bobsId, x: 1, y: 2 } }]);
    expect(send(room, a, { t: "drag", id: handCard, x: 1, y: 2 }).outbound).toEqual([{ to: "player", playerId: b, msg: { t: "drag", by: a, id: `hand:${a}`, x: 1, y: 2 } }]);
    // Nothing for ids the sender doesn't know, or cards that can't be dragged.
    expect(send(room, b, { t: "drag", id: handCard, x: 1, y: 2 }).outbound).toEqual([]);
    // Nor can Bob drag Alice's hand around by the stand-in he knows her card by.
    const bobsHandId = room.viewFor(b).table!.players[a].zones.hand[0];
    expect(send(room, b, { t: "drag", id: bobsHandId, x: 1, y: 2 }).outbound).toEqual([]);
    const top = room.viewFor(a).table!.players[a].zones.library[0];
    expect(send(room, a, { t: "drag", id: top, x: 1, y: 2 }).outbound).toEqual([]);
  });

  it("gives a game saved before stand-ins existed fresh ones when it's loaded", () => {
    const { room, deps, a, b } = twoPlayerGame();
    const saved = structuredClone(room.state);
    delete saved.table!.standIns;
    const loaded = new Room(saved, room.cards, deps);
    const hand = loaded.viewFor(b).table!.players[a].zones.hand;
    expect(hand).toHaveLength(7);
    for (const id of hand) expect(saved.table!.cards[id]).toBeUndefined();
  });
});

describe("rejoining a started game", () => {
  function startedRoom() {
    const { room, deps } = newRoom();
    const a = room.join({ name: "Alice" });
    const b = room.join({ name: "Bob" });
    room.applyImport(importResult());
    send(room, a.playerId, { t: "setReady", ready: true });
    send(room, b.playerId, { t: "setReady", ready: true });
    expect(room.state.phase).toBe("drafting");
    return { room, deps, a, b };
  }

  it("offers disconnected seats to a joiner without a valid secret", () => {
    const { room, a, b } = startedRoom();
    expect(() => room.join({ name: "Alice (phone)" })).toThrow(/every seat is in use/);
    room.setConnected(b.playerId, false);
    try {
      room.join({ name: "Bob (phone)" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SeatClaimNeeded);
      expect((err as SeatClaimNeeded).seats).toEqual([{ id: b.playerId, name: "Bob", avatar: undefined }]);
    }
    expect(() => room.join({ claim: a.playerId })).toThrow(/already playing as Alice/);
  });

  it("hands a claimed seat a new secret and retires the old one", () => {
    const { room, b } = startedRoom();
    room.setConnected(b.playerId, false);
    const claimed = room.join({ claim: b.playerId });
    expect(claimed.playerId).toBe(b.playerId);
    expect(claimed.secret).not.toBe(b.secret);
    expect(room.state.players.find((p) => p.id === b.playerId)?.connected).toBe(true);
    room.setConnected(b.playerId, false);
    // The old device's secret no longer works; it gets the seat picker instead.
    expect(() => room.join({ playerId: b.playerId, secret: b.secret })).toThrow(SeatClaimNeeded);
    expect(room.join({ playerId: b.playerId, secret: claimed.secret }).playerId).toBe(b.playerId);
  });

  it("joins as a new player in the lobby even with a claim", () => {
    const { room } = newRoom();
    const a = room.join({ name: "A" });
    room.setConnected(a.playerId, false);
    expect(room.join({ claim: a.playerId }).playerId).not.toBe(a.playerId);
  });
});

describe("draft clock while nobody is here", () => {
  function timedDraft() {
    const { room, deps } = newRoom();
    const a = room.join({ name: "A" });
    room.applyImport(importResult());
    send(room, a.playerId, { t: "addBot" });
    send(room, a.playerId, { t: "config", draft: { pickTimerSec: 30 } });
    send(room, a.playerId, { t: "setReady", ready: true });
    return { room, deps, a };
  }

  it("pauses when the last human leaves and gives the time back on return", () => {
    const { room, deps, a } = timedDraft();
    const deadline = room.nextAlarm()!;
    expect(deadline).toBe(deps.now() + 30_000);

    deps.advance(10_000);
    room.setConnected(a.playerId, false);
    expect(room.nextAlarm()).toBeNull();

    // Two weeks later, nothing has been auto-picked.
    deps.advance(14 * 24 * 3_600_000);
    expect(room.tick()).toBe(false);
    expect(room.state.draft!.picks[a.playerId]).toHaveLength(0);

    room.join({ playerId: a.playerId, secret: room.state.secrets[a.playerId] });
    expect(room.nextAlarm()).toBe(deps.now() + 20_000);
    deps.advance(20_000);
    expect(room.tick()).toBe(true);
    expect(room.state.draft!.picks[a.playerId]).toHaveLength(1);
  });

  it("syncs connection flags with the sockets actually present", () => {
    const { room, a } = timedDraft();
    expect(room.syncConnections(new Set())).toBe(true);
    expect(room.state.players.find((p) => p.id === a.playerId)?.connected).toBe(false);
    expect(room.nextAlarm()).toBeNull();
    expect(room.syncConnections(new Set())).toBe(false);
    expect(room.syncConnections(new Set([a.playerId]))).toBe(true);
    expect(room.nextAlarm()).not.toBeNull();
  });
});

describe("avatars and companions", () => {
  it("leaves humans without an avatar or companion, and deals bots both", () => {
    const { room } = newRoom();
    const host = room.join({ name: "Alice" });
    room.join({ name: "Bob" });
    for (let i = 0; i < 4; i++) send(room, host.playerId, { t: "addBot" });
    const [alice, bob, ...bots] = room.state.players;
    for (const human of [alice, bob]) {
      expect(human.avatar).toBeUndefined();
      expect(human.companion).toBeUndefined();
    }
    expect(bots).toHaveLength(4);
    expect(bots.every((b) => b.avatar && b.companion)).toBe(true);
    // Bots avoid each other's avatars while there are free ones.
    expect(new Set(bots.map((b) => b.avatar)).size).toBe(4);
  });

  it("starts a joiner with what they picked before, and gives a second holder a different variant", () => {
    const { room } = newRoom();
    room.join({ name: "Alice", avatar: "sable", companion: "foil" });
    room.join({ name: "Bob", avatar: "sable", companion: "foil" });
    room.join({ name: "Cleo", avatar: "sable" });
    const [alice, bob, cleo] = room.state.players;
    expect([alice.avatar, bob.avatar, cleo.avatar]).toEqual(["sable", "sable", "sable"]);
    expect([alice.avatarVariant, bob.avatarVariant, cleo.avatarVariant]).toEqual([0, 1, 2]);
    expect([alice.companionVariant, bob.companionVariant]).toEqual([0, 1]);
    expect(cleo.companion).toBeUndefined();
    expect(cleo.companionVariant).toBeUndefined();

    room.join({ name: "Dee", avatar: "nonsense" });
    expect(room.state.players[3].avatar).toBeUndefined();
  });

  it("lets players pick anything, share it, and clear it again", () => {
    const { room } = newRoom();
    const a = room.join({ name: "Alice", avatar: "sable", companion: "foil" });
    const b = room.join({ name: "Bob" });
    expect(send(room, b.playerId, { t: "setLook", avatar: "sable", companion: "cinder" }).changed).toBe(true);
    const [alice, bob] = room.state.players;
    expect(bob).toMatchObject({ avatar: "sable", avatarVariant: 1, companion: "cinder", companionVariant: 0 });

    // The first holder keeps the original look when the second one leaves; the next one reuses the freed variant.
    expect(send(room, b.playerId, { t: "setLook", avatar: null }).changed).toBe(true);
    expect(bob.avatar).toBeUndefined();
    expect(bob.avatarVariant).toBeUndefined();
    expect(bob.companion).toBe("cinder");
    send(room, b.playerId, { t: "setLook", avatar: "sable" });
    expect(bob.avatarVariant).toBe(1);
    expect(alice.avatarVariant).toBe(0);

    // Alice moves on: Bob's colours stay as they were.
    send(room, a.playerId, { t: "setLook", avatar: "odalys" });
    expect(bob.avatarVariant).toBe(1);
    expect(alice).toMatchObject({ avatar: "odalys", avatarVariant: 0 });
  });

  it("only lets looks change in the lobby", () => {
    const { room } = newRoom();
    const host = room.join({ name: "Alice" });
    send(room, host.playerId, { t: "import", source: "x" });
    room.applyImport(importResult());
    send(room, host.playerId, { t: "addBot" });
    send(room, host.playerId, { t: "addBot" });
    send(room, host.playerId, { t: "setReady", ready: true });
    expect(room.state.phase).toBe("drafting");
    const res = send(room, host.playerId, { t: "setLook", avatar: "pip" });
    expect(res.outbound[0].msg).toMatchObject({ t: "error" });
  });

  it("tidies rooms saved before looks existed or with retired ids", () => {
    const { room, deps } = newRoom();
    const host = room.join({ name: "Alice", avatar: "sable" });
    room.join({ name: "Bob", avatar: "sable" });
    send(room, host.playerId, { t: "addBot" });
    const [alice, bob, bot] = room.state.players;
    delete bot.avatar;
    delete bot.companion;
    bob.avatar = "retired-hero";
    delete alice.avatarVariant;
    const reloaded = new Room(room.state, {}, deps);
    const [a2, b2, bot2] = reloaded.state.players;
    expect(b2.avatar).toBeUndefined();
    expect(a2.avatarVariant).toBe(0);
    expect(bot2.avatar && bot2.companion).toBeTruthy();
  });

  it("shows the seat's avatar to anyone rejoining a started game", () => {
    const { room } = newRoom();
    const host = room.join({ name: "Alice", avatar: "pip" });
    room.join({ name: "Bob" });
    room.state.phase = "playing";
    room.setConnected(host.playerId, false);
    room.setConnected(room.state.players[1].id, false);
    expect(room.claimableSeats()).toEqual([
      { id: host.playerId, name: "Alice", avatar: "pip" },
      { id: room.state.players[1].id, name: "Bob", avatar: undefined },
    ]);
  });
});
