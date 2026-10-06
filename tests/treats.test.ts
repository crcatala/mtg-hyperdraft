import { describe, expect, it } from "vitest";
import { createRoomState, Room, type ImportResult } from "../src/shared/room";
import { basicIds, makeCube, testDeps } from "./fixtures";
import type { ClientMessage, ServerMessage } from "../src/shared/protocol";
import { mulberry32 } from "../src/shared/rng";
import { MAT_D, MAT_W, petSpotValid, tableRadius, tableToLocal } from "../src/shared/tableLayout";
import { clientMessageSchema } from "../src/shared/protocol";
import { COMPANION_IDS } from "../src/shared/roster";
import {
  aTreat,
  GLIMMER_START,
  glimmersLeft,
  LAND_AT,
  LANDING_R,
  machineSpot,
  MACHINE_R,
  pickLanding,
  planShow,
  RACE_AT,
  runPose,
  showMs,
  theTreat,
  TREAT_LINES,
  TREATS,
  treatDef,
  tripTime,
  VEND_HOLD_MS,
  winLine,
  type TreatShowSpec,
} from "../src/shared/treats";

const spec = (seed: number, racers = 4): TreatShowSpec => ({
  by: "u1",
  treat: "golden-pickle",
  seed,
  at: { x: 0, y: 0 },
  racers: [
    { id: "u1", companion: "hex", x: 14, y: 16 },
    { id: "u2", companion: "gloop", x: -16, y: 14 },
    { id: "u3", companion: "crit", x: -14, y: -16 },
    { id: "u4", companion: "ribbit", x: 16, y: -14 },
  ].slice(0, racers),
});

describe("the treats", () => {
  it("has ten, each with its art and a price within a full purse", () => {
    expect(TREATS).toHaveLength(10);
    expect(new Set(TREATS.map((t) => t.id)).size).toBe(10);
    for (const t of TREATS) {
      expect(t.cost).toBeGreaterThan(0);
      expect(t.cost).toBeLessThanOrEqual(GLIMMER_START);
    }
    const art = Object.keys(import.meta.glob("../public/treats/*.webp")).map((p) => p.split("/").pop()!.replace(".webp", ""));
    expect(art.sort()).toEqual(TREATS.map((t) => t.id).sort());
  });

  it("gives every companion three win lines naming the treat, and two trip lines", () => {
    expect(Object.keys(TREAT_LINES).sort()).toEqual([...COMPANION_IDS].sort());
    for (const lines of Object.values(TREAT_LINES)) {
      expect(lines.win).toHaveLength(3);
      expect(lines.trip).toHaveLength(2);
      for (const w of lines.win) expect(w).toContain("{treat}");
    }
    expect(winLine("hex", 0, treatDef("moonlit-macaron")!)).toBe("Moonlit Macaron was always mine.");
  });

  it("picks the right article", () => {
    expect(aTreat(treatDef("moonlit-macaron")!)).toBe("a Moonlit Macaron");
    expect(aTreat(treatDef("golden-pickle")!)).toBe("The Golden Pickle");
    expect(theTreat(treatDef("rubber-duck")!)).toBe("the Distinguished Duck");
  });

  it("starts everyone with a full purse (saved games included)", () => {
    expect(glimmersLeft(undefined)).toBe(GLIMMER_START);
    expect(glimmersLeft({})).toBe(GLIMMER_START);
    expect(glimmersLeft({ glimmers: 3 })).toBe(3);
  });
});

describe("the race", () => {
  it("is the same on every screen: the plan depends on the spec alone", () => {
    expect(planShow(spec(42))).toEqual(planShow(spec(42)));
    expect(JSON.stringify(planShow(spec(42)))).not.toBe(JSON.stringify(planShow(spec(43))));
  });

  it("is won by whoever reaches the treat first, and every loser gets to its spot only after", () => {
    for (let seed = 1; seed < 300; seed++) {
      const plan = planShow(spec(seed));
      const winner = plan.runs.find((r) => r.id === plan.winner)!;
      expect(winner.arrive).toBeCloseTo(plan.takenAt, 6);
      for (const r of plan.runs) {
        expect(r.go).toBeGreaterThanOrEqual(RACE_AT);
        if (r !== winner) expect(r.arrive).toBeGreaterThan(plan.takenAt);
      }
      // The winner really is at the treat when it's taken; the race starts after the treat has landed.
      const at = runPose(winner, plan, plan.takenAt + 0.01);
      expect(Math.hypot(at.x, at.y)).toBeLessThan(1);
      expect(plan.endAt).toBeGreaterThan(plan.homeAt);
      expect(RACE_AT).toBeGreaterThan(LAND_AT);
    }
  });

  it("varies who wins and has the odd trip", () => {
    const winners = new Set<string>();
    let trips = 0;
    for (let seed = 1; seed < 200; seed++) {
      const plan = planShow(spec(seed));
      winners.add(plan.winner!);
      trips += plan.runs.filter((r) => tripTime(r) !== null).length;
    }
    expect(winners.size).toBe(4);
    expect(trips).toBeGreaterThan(100);
  });

  it("starts everyone from their spot and brings them back to it", () => {
    const plan = planShow(spec(7));
    for (const r of plan.runs) {
      expect(runPose(r, plan, 0)).toMatchObject({ x: r.start.x, y: r.start.y, state: "wait" });
      expect(runPose(r, plan, plan.endAt + 1)).toMatchObject({ x: r.start.x, y: r.start.y, state: "home" });
    }
  });

  it("moves continuously, through trips and give-ups", () => {
    for (let seed = 1; seed < 60; seed++) {
      const plan = planShow(spec(seed));
      for (const r of plan.runs) {
        let last = runPose(r, plan, 0);
        for (let t = 0.02; t < plan.endAt + 0.5; t += 0.02) {
          const p = runPose(r, plan, t);
          // At most a sprint's worth (and the tumble of a trip) per step.
          expect(Math.hypot(p.x - last.x, p.y - last.y)).toBeLessThan(Math.max(r.speed, 60) * 0.02 + 0.08);
          last = p;
        }
      }
    }
  });

  it("with nobody to race, it just fizzles out", () => {
    const plan = planShow(spec(3, 0));
    expect(plan.winner).toBeNull();
    expect(plan.endAt).toBeGreaterThan(LAND_AT);
  });
});

describe("where it stands and lands", () => {
  it("puts each seat's machine on the table and clear of every mat, at any seat count", () => {
    for (let n = 1; n <= 4; n++) {
      for (let seat = 0; seat < n; seat++) {
        const m = machineSpot(seat, n);
        expect(Math.hypot(m.x, m.y)).toBeLessThanOrEqual(tableRadius(n) - MACHINE_R);
        for (let s = 0; s < n; s++) {
          const l = tableToLocal(m, s, n);
          expect(Math.abs(l.x) >= MAT_W / 2 + MACHINE_R || Math.abs(l.y) >= MAT_D / 2 + MACHINE_R).toBe(true);
        }
      }
    }
  });

  it("lands somewhere any companion can stand, clear of every machine", () => {
    const rng = mulberry32(9);
    for (let n = 1; n <= 4; n++) {
      for (let i = 0; i < 200; i++) {
        const p = pickLanding(n, rng);
        expect(petSpotValid(p, n, -1)).toBe(true);
        expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(LANDING_R);
        for (let s = 0; s < n; s++) {
          const m = machineSpot(s, n);
          expect(Math.hypot(m.x - p.x, m.y - p.y)).toBeGreaterThan(MACHINE_R);
        }
      }
    }
  });
});

// --- the room -----------------------------------------------------------------------------------

function importResult(n = 400): ImportResult {
  const cards = Object.values(makeCube(n));
  return { name: "Test Cube", source: "test", cards, pool: cards.filter((c) => !c.id.startsWith("basic")).map((c) => c.id), notFound: [], warnings: [], basics: basicIds };
}

function game() {
  const deps = testDeps();
  const room = new Room(createRoomState("ABCDEF", deps.now()), {}, deps);
  const a = room.join({ name: "Alice", companion: "hex" });
  const b = room.join({ name: "Bob", companion: "gloop" });
  const c = room.join({ name: "Cara" }); // no companion
  room.applyImport(importResult());
  room.handle(a.playerId, { t: "debug", cmd: "startGame" });
  expect(room.state.phase).toBe("playing");
  return { room, deps, a: a.playerId, b: b.playerId, c: c.playerId };
}
const send = (room: Room, pid: string, msg: ClientMessage) => room.handle(pid, msg);
const msgs = (res: ReturnType<Room["handle"]>, t: ServerMessage["t"]) => res.outbound.filter((o) => o.msg.t === t);
const errorOf = (res: ReturnType<Room["handle"]>) => res.outbound.find((o) => o.msg.t === "error")?.msg as { message: string } | undefined;

describe("the Treatomancer in a room", () => {
  it("lets one player browse at a time, tells everyone who, and lets go when they close it", () => {
    const { room, a, b } = game();
    const open = send(room, a, { t: "vend", open: true });
    expect(open.changed).toBe(false);
    expect(msgs(open, "vend").map((o) => o.to).sort()).toEqual(["others", "self"]);
    expect(msgs(open, "vend")[0].msg).toMatchObject({ t: "vend", by: a });
    expect(room.viewFor(b).vend?.by).toBe(a);

    const denied = send(room, b, { t: "vend", open: true });
    expect(errorOf(denied)?.message).toBe("Alice is browsing the Treatomancer.");
    expect(msgs(denied, "vend")).toEqual([{ to: "self", msg: expect.objectContaining({ t: "vend", by: a }) }]);
    // Nor can they buy over Alice's shoulder.
    expect(errorOf(send(room, b, { t: "treat", treat: "cursed-sock" }))?.message).toBe("Alice is browsing the Treatomancer.");

    // Closing someone else's hold does nothing; closing your own frees it.
    expect(send(room, b, { t: "vend", open: false }).outbound).toEqual([]);
    expect(msgs(send(room, a, { t: "vend", open: false }), "vend")[0].msg).toEqual({ t: "vend", by: null });
    expect(room.viewFor(b).vend).toBeNull();
    expect(msgs(send(room, b, { t: "vend", open: true }), "vend")[0].msg).toMatchObject({ by: b });
  });

  it("lets go of a hold that runs out, or whose holder drops out", () => {
    const { room, deps, a, b } = game();
    send(room, a, { t: "vend", open: true });
    deps.advance(VEND_HOLD_MS + 1);
    expect(room.viewFor(b).vend).toBeNull();
    send(room, b, { t: "vend", open: true });
    room.setConnected(b, false);
    expect(room.viewFor(a).vend).toBeNull();
  });

  it("sells a treat for glimmers, stored, and sends everyone the same show", () => {
    const { room, a, b, c } = game();
    send(room, a, { t: "vend", open: true });
    const res = send(room, a, { t: "treat", treat: "golden-pickle" });
    expect(res.changed).toBe(true);
    expect(room.state.table!.players[a].glimmers).toBe(GLIMMER_START - 6);
    expect(room.viewFor(a).table!.players[a].glimmers).toBe(GLIMMER_START - 6);
    const shows = msgs(res, "treat");
    expect(shows.map((o) => o.to).sort()).toEqual(["others", "self"]);
    const show = (shows[0].msg as { show: TreatShowSpec }).show;
    expect(shows[1].msg).toEqual(shows[0].msg);
    expect(show).toMatchObject({ by: a, treat: "golden-pickle" });
    // Only companions at the table race (Cara has none), from where they stand.
    expect(show.racers.map((r) => r.id).sort()).toEqual([a, b].sort());
    expect(show.racers.find((r) => r.id === c)).toBeUndefined();
    expect(petSpotValid(show.at, 3, -1)).toBe(true);
    // The hold ends with the purchase, and it's in the log.
    expect(room.viewFor(b).vend).toBeNull();
    expect(room.state.table!.log.at(-1)).toMatchObject({ kind: "treat", text: "Alice fed the Treatomancer 6 glimmers: The Golden Pickle!" });
  });

  it("buys without browsing first (a hold lost to a restart), but never beyond the purse", () => {
    const { room, deps, a } = game();
    expect(send(room, a, { t: "treat", treat: "golden-pickle" }).changed).toBe(true);
    deps.advance(60_000);
    expect(send(room, a, { t: "treat", treat: "golden-pickle" }).changed).toBe(true);
    deps.advance(60_000);
    const broke = send(room, a, { t: "treat", treat: "cursed-sock" });
    expect(broke.changed).toBe(false);
    expect(errorOf(broke)?.message).toBe("Not enough glimmers for that one.");
    expect(room.state.table!.players[a].glimmers).toBe(0);
  });

  it("keeps everyone's hands off the companions and the machine while the show plays", () => {
    const { room, deps, a, b } = game();
    const res = send(room, a, { t: "treat", treat: "moonlit-macaron" });
    const show = (msgs(res, "treat")[0].msg as { show: TreatShowSpec }).show;
    expect(room.viewFor(b).showUntil).toBeGreaterThan(deps.now());
    expect(errorOf(send(room, b, { t: "vend", open: true }))).toBeDefined();
    expect(errorOf(send(room, b, { t: "treat", treat: "cursed-sock" }))?.message).toBe("Wait for the last treat to be gobbled first.");
    expect(send(room, b, { t: "poke", target: a, step: 0 }).outbound).toEqual([]);
    expect(send(room, b, { t: "emote", slot: 0 }).outbound).toEqual([]);
    expect(send(room, b, { t: "petMove", x: 1, y: 1 }).outbound).toEqual([]);
    expect(send(room, b, { t: "setPetPos", at: { x: 0.1, y: 0.1 } }).changed).toBe(false);
    // Once it's over, everything is back.
    deps.advance(showMs(show) + 400);
    expect(room.viewFor(b).showUntil).toBeNull();
    expect(msgs(send(room, b, { t: "poke", target: a, step: 0 }), "poke")).toHaveLength(1);
    expect(msgs(send(room, b, { t: "vend", open: true }), "vend")[0].msg).toMatchObject({ by: b });
  });

  it("is only for players at the table, and only takes treats it sells", () => {
    const deps = testDeps();
    const room = new Room(createRoomState("ABCDEF", deps.now()), {}, deps);
    const a = room.join({ name: "Alice", companion: "hex" }).playerId;
    expect(errorOf(send(room, a, { t: "vend", open: true }))).toBeDefined();
    expect(clientMessageSchema.safeParse({ t: "treat", treat: "golden-pickle" }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ t: "treat", treat: "free-money" }).success).toBe(false);
  });
});
