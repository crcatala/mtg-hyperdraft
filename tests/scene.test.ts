import { describe, expect, it } from "vitest";
import { createRoomState, Room, type ImportResult } from "../src/shared/room";
import { clientMessageSchema, type ClientMessage } from "../src/shared/protocol";
import { DEFAULT_SCENE, ENVIRONMENTS, resolveScene, TABLE_STYLES } from "../src/shared/scene";
import { basicIds, makeCube, testDeps } from "./fixtures";
import { TITLE_SCENES } from "../src/client/scene/titleScenes";
import { THEMES } from "../src/client/theme";
import { CARD_H, CARD_W, MAT_D, MAT_W, PILE_LOCAL, localToTable, seatRadius, tableRadius } from "../src/shared/tableLayout";

function importResult(n = 400): ImportResult {
  const cards = Object.values(makeCube(n));
  return { name: "Test Cube", source: "test", cards, pool: cards.filter((c) => !c.id.startsWith("basic")).map((c) => c.id), notFound: [], warnings: [], basics: basicIds };
}

function playing() {
  const deps = testDeps();
  const room = new Room(createRoomState("ABCDEF", deps.now()), {}, deps);
  const a = room.join({ name: "Alice" });
  const b = room.join({ name: "Bob" });
  room.applyImport(importResult());
  room.handle(a.playerId, { t: "debug", cmd: "startGame" });
  return { room, a: a.playerId, b: b.playerId };
}

const send = (room: Room, pid: string, msg: ClientMessage) => room.handle(pid, msg);

describe("scene (table and environment)", () => {
  it("fills in defaults for rooms that never chose, and for retired ids", () => {
    expect(resolveScene(undefined)).toEqual(DEFAULT_SCENE);
    expect(resolveScene({ table: "runestone" })).toEqual({ table: "runestone", env: DEFAULT_SCENE.env });
    expect(resolveScene({ table: "gone" as never, env: "grove" })).toEqual({ table: DEFAULT_SCENE.table, env: "grove" });
    const { room, a } = playing();
    expect(room.viewFor(a).scene).toEqual(DEFAULT_SCENE);
  });

  it("offers three of each", () => {
    expect(TABLE_STYLES).toHaveLength(3);
    expect(ENVIRONMENTS).toHaveLength(3);
  });

  it("gives every UI theme its own title backdrop, showing each environment and table once", () => {
    expect(Object.keys(TITLE_SCENES).sort()).toEqual(THEMES.map((t) => t.id).sort());
    expect(new Set(Object.values(TITLE_SCENES).map((s) => s.env)).size).toBe(ENVIRONMENTS.length);
    expect(new Set(Object.values(TITLE_SCENES).map((s) => s.table)).size).toBe(TABLE_STYLES.length);
  });

  it("is changed by anyone at the table, for everyone, with a line in the log", () => {
    const { room, a, b } = playing();
    const before = structuredClone(room.state.table!.cards);
    const res = send(room, b, { t: "scene", env: "grove" });
    expect(res.changed).toBe(true);
    expect(room.viewFor(a).scene).toEqual({ table: DEFAULT_SCENE.table, env: "grove" });
    expect(room.viewFor(b).scene).toEqual({ table: DEFAULT_SCENE.table, env: "grove" });
    expect(room.state.table!.log.at(-1)).toMatchObject({ playerId: b, kind: "scene", text: "Bob moved the game to the Moonlit grove." });

    send(room, a, { t: "scene", table: "oak" });
    expect(room.viewFor(b).scene).toEqual({ table: "oak", env: "grove" });
    expect(room.state.table!.log.at(-1)?.text).toBe("Alice changed the table to Oak & brass.");

    send(room, a, { t: "scene", table: "runestone", env: "library" });
    expect(room.state.table!.log.at(-1)?.text).toBe("Alice set the scene: Runestone in the Arcane library.");
    // Purely cosmetic: not a card moved.
    expect(room.state.table!.cards).toEqual(before);
  });

  it("ignores a choice that changes nothing (no write, no log line)", () => {
    const { room, a } = playing();
    const logged = room.state.table!.log.length;
    expect(send(room, a, { t: "scene", table: DEFAULT_SCENE.table }).changed).toBeFalsy();
    expect(room.state.table!.log).toHaveLength(logged);
  });

  it("is only for the table, and survives into the next game", () => {
    const deps = testDeps();
    const room = new Room(createRoomState("ABCDEF", deps.now()), {}, deps);
    const a = room.join({ name: "Alice" }).playerId;
    room.applyImport(importResult());
    expect(send(room, a, { t: "scene", env: "grove" }).outbound[0]?.msg).toMatchObject({ t: "error" });
    send(room, a, { t: "debug", cmd: "startGame" });
    send(room, a, { t: "scene", env: "grove" });
    send(room, a, { t: "debug", cmd: "toLobby" });
    send(room, a, { t: "debug", cmd: "startGame" });
    expect(room.viewFor(a).scene.env).toBe("grove");
  });

  it("refuses ids that don't exist", () => {
    expect(clientMessageSchema.safeParse({ t: "scene", table: "felt" }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ t: "scene", env: "volcano" }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ t: "scene", table: "felt", env: "tavern" }).success).toBe(true);
  });
});

describe("table size", () => {
  // Every table design is drawn around this disc, so mats and the cards beside them never reach the rim.
  it("keeps every mat, pile and opponent hand well inside the play area", () => {
    for (let n = 1; n <= 4; n++) {
      const r = tableRadius(n);
      for (const [x, y] of [
        [MAT_W / 2, MAT_D / 2],
        [-MAT_W / 2, MAT_D / 2],
        [MAT_W / 2, -MAT_D / 2],
      ]) {
        const p = localToTable({ x, y }, 0, n);
        expect(Math.hypot(p.x, p.y), `${n} seats, mat corner`).toBeLessThanOrEqual(r - 3);
      }
      for (const c of Object.values(PILE_LOCAL)) {
        const p = localToTable({ x: c.x + CARD_W / 2, y: c.y + CARD_H / 2 }, 0, n);
        expect(Math.hypot(p.x, p.y), `${n} seats, pile`).toBeLessThan(r - 3);
      }
      // Other players' hands lie just past the far edge of their mat.
      if (n > 1) expect(seatRadius(n) + MAT_D / 2 + 2.4 + CARD_H * 0.7, `${n} seats, hand`).toBeLessThan(r);
    }
  });
});
