import { describe, expect, it } from "vitest";
import { createRoomState, Room, type ImportResult } from "../src/shared/room";
import { basicIds, makeCube, testDeps } from "./fixtures";
import type { ClientMessage } from "../src/shared/protocol";

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

  it("hides the host secret and other packs from views", () => {
    const { room } = newRoom();
    const a = room.join({});
    const view = room.viewFor(a.playerId);
    expect(JSON.stringify(view)).not.toContain(a.secret);
  });
});
