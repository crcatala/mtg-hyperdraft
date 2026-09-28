import { describe, expect, it } from "vitest";
import {
  durationLabel,
  emptyPool,
  nextRoomMs,
  poolStatus,
  PUBLIC_LIMITS,
  prunePool,
  publicBlocker,
  releaseSlots,
  reserveSlot,
  rollDay,
  unreserveSlot,
  utcDay,
  visitorPrefix,
  type PublicPool,
  type PublicSlot,
} from "../src/shared/publicRooms";
import { FloodControl, RATE_LIMITS, TokenBucket } from "../src/shared/rateLimit";
import { createRoomState, Room } from "../src/shared/room";
import { dueWarning, timeLeft } from "../src/client/expiry";
import { testDeps } from "./fixtures";

const MIN = 60_000;
const HOUR = 60 * MIN;
/** 10:00 UTC on some day. */
const T = Date.UTC(2026, 8, 28, 10);

function slot(code: string, createdAt: number, visitor = code.toLowerCase()): PublicSlot {
  return { code, createdAt, expiresAt: createdAt + PUBLIC_LIMITS.ttlMs, visitor, day: utcDay(createdAt) };
}

/** A pool as the Durable Object keeps it: rooms are created through reserveSlot. */
function poolWith(...rooms: [code: string, visitor: string, at: number][]): PublicPool {
  const pool = emptyPool();
  for (const [code, visitor, at] of rooms) reserveSlot(pool, visitor, at).code = code;
  return pool;
}

describe("public room pool", () => {
  it("allows up to 3 rooms at once, then says when one frees up", () => {
    const pool = emptyPool();
    pool.slots = [slot("A", T - 5 * HOUR), slot("B", T - 2 * HOUR)];
    expect(publicBlocker(pool, "me", T)).toBeNull();
    expect(poolStatus(pool, T)).toMatchObject({ slots: 3, used: 2, nextFreeAt: null });

    pool.slots.push(slot("C", T - HOUR));
    const blocker = publicBlocker(pool, "me", T);
    expect(blocker?.status).toBe(429);
    expect(blocker?.error).toMatch(/All 3 public tables are in use.*in about 1h/);
    // A's expiry is the next guaranteed free slot.
    expect(poolStatus(pool, T).nextFreeAt).toBe(T + HOUR);
  });

  it("frees slots at their expiry without anyone releasing them", () => {
    const pool = emptyPool();
    pool.slots = [slot("A", T - PUBLIC_LIMITS.ttlMs), slot("B", T - HOUR), slot("C", T - HOUR)];
    expect(poolStatus(pool, T).used).toBe(2);
    expect(publicBlocker(pool, "me", T)).toBeNull();
    prunePool(pool, T);
    expect(pool.slots.map((s) => s.code)).toEqual(["B", "C"]);
  });

  it("gives each visitor one public room at a time", () => {
    const pool = poolWith(["A", "sam", T - HOUR]);
    expect(publicBlocker(pool, "sam", T)).toMatchObject({ status: 409, code: "A", expiresAt: T + 5 * HOUR });
    expect(publicBlocker(pool, "jo", T)).toBeNull();
  });

  it("gives each visitor two public rooms per UTC day", () => {
    const pool = poolWith(["A", "sam", T - 3 * HOUR]);
    releaseSlots(pool, new Set(["A"]), T - 2 * HOUR);
    reserveSlot(pool, "sam", T - HOUR).code = "B";
    releaseSlots(pool, new Set(["B"]), T - 30 * MIN);
    expect(publicBlocker(pool, "sam", T)).toMatchObject({ status: 429, error: expect.stringMatching(/hosted 2 public rooms today/) });
    expect(publicBlocker(pool, "jo", T)).toBeNull();
    // A new UTC day starts over.
    expect(publicBlocker(pool, "sam", Date.UTC(2026, 8, 29, 0, 5))).toBeNull();
  });
});

describe("public room daily budget", () => {
  it("reserves each room's whole lifetime and refunds what an early close didn't use", () => {
    const pool = poolWith(["A", "sam", T]);
    expect(pool.usedMs).toBe(6 * HOUR);
    // Closed after 2 hours (idle): 4 hours go back to the budget.
    expect(releaseSlots(pool, new Set(["A"]), T + 2 * HOUR)).toBe(true);
    expect(pool.usedMs).toBe(2 * HOUR);
    expect(pool.slots).toEqual([]);
  });

  it("shortens the last rooms of the day to what's left, then closes for the day", () => {
    const pool = poolWith(["A", "a", T], ["B", "b", T]);
    expect(nextRoomMs(pool, T)).toBe(0);
    expect(poolStatus(pool, T)).toMatchObject({ nextRoomMs: 0, reopensAt: Date.UTC(2026, 8, 29) });
    expect(publicBlocker(pool, "c", T)?.error).toMatch(/all booked/);

    // B closes after an hour: 5 hours come back, and the next room may run them all.
    releaseSlots(pool, new Set(["B"]), T + HOUR);
    expect(nextRoomMs(pool, T + HOUR)).toBe(5 * HOUR);
    const c = reserveSlot(pool, "c", T + HOUR);
    expect(c.expiresAt).toBe(T + 6 * HOUR);
    expect(pool.usedMs).toBe(PUBLIC_LIMITS.dailyBudgetMs);
  });

  it("doesn't start rooms shorter than the minimum", () => {
    const pool = emptyPool();
    rollDay(pool, T);
    pool.usedMs = PUBLIC_LIMITS.dailyBudgetMs - PUBLIC_LIMITS.minRoomMs + 1;
    expect(nextRoomMs(pool, T)).toBe(0);
    pool.usedMs -= 1;
    expect(nextRoomMs(pool, T)).toBe(PUBLIC_LIMITS.minRoomMs);
  });

  it("charges a room to the day it was created, with no refund after midnight", () => {
    const late = Date.UTC(2026, 8, 28, 22);
    const pool = poolWith(["A", "sam", late]);
    const nextDay = Date.UTC(2026, 8, 29, 1);
    releaseSlots(pool, new Set(["A"]), nextDay);
    expect(pool.day).toBe("2026-09-29");
    expect(pool.usedMs).toBe(0);
  });

  it("gives back everything when a room couldn't be created", () => {
    const pool = emptyPool();
    const s = reserveSlot(pool, "sam", T);
    unreserveSlot(pool, s);
    expect(pool).toMatchObject({ slots: [], usedMs: 0, hosted: { sam: 0 } });
  });

  it("releases by code, so a list that changed during an await is safe", () => {
    const pool = poolWith(["A", "a", T], ["B", "b", T]);
    // A liveness check started with [A, B]; meanwhile A released itself and C was created.
    releaseSlots(pool, new Set(["A"]), T + MIN);
    reserveSlot(pool, "c", T + MIN).code = "C";
    // The check then finds B dead. Filtering by position would have dropped C instead.
    releaseSlots(pool, new Set(["B"]), T + 2 * MIN);
    expect(pool.slots.map((s) => s.code)).toEqual(["C"]);
    expect(releaseSlots(pool, new Set(["B", "nope"]), T + 3 * MIN)).toBe(false);
  });
});

describe("limit labels", () => {
  it("reads limits as whole hours or minutes", () => {
    expect(durationLabel(6 * HOUR)).toBe("6 hours");
    expect(durationLabel(HOUR)).toBe("1 hour");
    expect(durationLabel(15 * MIN)).toBe("15 minutes");
    expect(durationLabel(90 * MIN)).toBe("90 minutes");
    expect(durationLabel(MIN)).toBe("1 minute");
  });
});

describe("visitor prefixes", () => {
  it("keeps whole IPv4 addresses", () => {
    expect(visitorPrefix("203.0.113.9")).toBe("203.0.113.9");
    expect(visitorPrefix(null)).toBe("unknown");
    expect(visitorPrefix("")).toBe("unknown");
  });

  it("groups IPv6 addresses by /64", () => {
    const a = visitorPrefix("2001:db8:abcd:12::1");
    expect(a).toBe("2001:db8:abcd:12");
    expect(visitorPrefix("2001:0db8:abcd:0012:ffff:1:2:3")).toBe(a);
    expect(visitorPrefix("2001:DB8:ABCD:12:0:0:0:99")).toBe(a);
    expect(visitorPrefix("2001:db8:abcd:13::1")).not.toBe(a);
    expect(visitorPrefix("2001:db8::1")).toBe("2001:db8:0:0");
    expect(visitorPrefix("::1")).toBe("0:0:0:0");
  });

  it("treats IPv4 written as IPv6 as that IPv4 visitor", () => {
    expect(visitorPrefix("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(visitorPrefix("::FFFF:198.51.100.7")).not.toBe(visitorPrefix("::ffff:203.0.113.9"));
  });
});

describe("token buckets", () => {
  it("allows a burst, then the sustained rate", () => {
    const b = new TokenBucket({ capacity: 3, perSecond: 2 }, 0);
    expect([b.take(0), b.take(0), b.take(0), b.take(0)]).toEqual([true, true, true, false]);
    expect(b.take(400)).toBe(false); // 0.8 tokens back
    expect(b.take(500)).toBe(true); // 1 token back
    expect(b.take(500)).toBe(false);
    // Refills up to capacity, no further.
    expect([b.take(60_000), b.take(60_000), b.take(60_000), b.take(60_000)]).toEqual([true, true, true, false]);
  });
});

describe("flood control", () => {
  it("lets normal play through, including a drag's burst of previews", () => {
    const f = new FloodControl(0);
    for (let i = 0; i < 40; i++) expect(f.check("s1", "p1", false, i * 50).verdict).toBe("ok");
  });

  it("drops over-budget messages with an occasional notice, then closes a socket that keeps at it", () => {
    const f = new FloodControl(0);
    for (let i = 0; i < RATE_LIMITS.socket.capacity; i++) f.check("s1", "p1", false, 0);
    expect(f.check("s1", "p1", false, 0)).toEqual({ verdict: "drop", notice: true });
    expect(f.check("s1", "p1", false, 0)).toEqual({ verdict: "drop", notice: false });
    let last = f.check("s1", "p1", false, 0);
    while (last.verdict === "drop") last = f.check("s1", "p1", false, 0);
    expect(last.verdict).toBe("close");
    // The player sits out the penalty, then may rejoin.
    expect(f.penalized("p1", 1000)).toBe(true);
    expect(f.penalized("p2", 1000)).toBe(false);
    expect(f.penalized("p1", RATE_LIMITS.penaltyMs + 1)).toBe(false);
  });

  it("caps sustained sending per socket, not just bursts", () => {
    const f = new FloodControl(0);
    // 25 messages a second fits the short-term bucket but not the sustained one, for long.
    let t = 0;
    let verdict = "ok";
    while (verdict === "ok" && t < 10 * 60_000) verdict = f.check("s1", "p1", false, (t += 40)).verdict;
    expect(verdict).toBe("drop");
    expect(t).toBeGreaterThan(60_000);
  });

  it("caps state changes per room, without blaming whoever hits the empty budget", () => {
    const f = new FloodControl(0);
    let writes = 0;
    for (let i = 0; i < 300; i++) if (f.check(`s${i % 4}`, `p${i % 4}`, true, i * 100).verdict === "ok") writes++;
    // 30 seconds: the burst of 120 plus about one per second.
    expect(writes).toBeGreaterThanOrEqual(RATE_LIMITS.roomWrites.capacity);
    expect(writes).toBeLessThan(RATE_LIMITS.roomWrites.capacity + 35);
    // A player sending at a normal pace into the empty budget gets drops, never a close.
    const verdicts = new Set<string>();
    for (let i = 0; i < 400; i++) verdicts.add(f.check("s9", "p9", true, 30_000 + i * 250).verdict);
    expect(verdicts).toEqual(new Set(["ok", "drop"]));
  });
});

describe("public room lifetime", () => {
  function publicRoom() {
    const deps = testDeps();
    const t0 = deps.now();
    const room = new Room(createRoomState("ABCDEFG", t0, { expiresAt: t0 + PUBLIC_LIMITS.ttlMs }), {}, deps);
    return { room, deps, t0 };
  }

  it("never closes invite rooms", () => {
    const deps = testDeps();
    const room = new Room(createRoomState("ABCDEFG", deps.now(), { inviteId: "sam" }), {}, deps);
    expect(room.closeAt()).toBeNull();
    expect(room.viewFor("nobody").expiresAt).toBeNull();
  });

  it("closes 15 minutes after creation if nobody joins", () => {
    const { room, t0 } = publicRoom();
    expect(room.closeAt()).toBe(t0 + PUBLIC_LIMITS.idleMs);
  });

  it("pauses the idle countdown while someone is here and restarts it when they leave", () => {
    const { room, deps, t0 } = publicRoom();
    deps.advance(5 * MIN);
    const a = room.join({ name: "Alice" });
    expect(room.state.idleSince).toBeNull();
    expect(room.closeAt()).toBe(t0 + PUBLIC_LIMITS.ttlMs);
    expect(room.viewFor(a.playerId).expiresAt).toBe(t0 + PUBLIC_LIMITS.ttlMs);

    deps.advance(HOUR);
    expect(room.setConnected(a.playerId, false)).toBe(true);
    expect(room.closeAt()).toBe(deps.now() + PUBLIC_LIMITS.idleMs);

    deps.advance(10 * MIN);
    room.join({ playerId: a.playerId, secret: a.secret });
    expect(room.closeAt()).toBe(t0 + PUBLIC_LIMITS.ttlMs);
  });

  it("keeps the hard expiry even when the idle countdown would run past it", () => {
    const { room, deps, t0 } = publicRoom();
    const a = room.join({});
    deps.advance(PUBLIC_LIMITS.ttlMs - 5 * MIN);
    room.setConnected(a.playerId, false);
    expect(room.closeAt()).toBe(t0 + PUBLIC_LIMITS.ttlMs);
  });

  it("notices everyone gone when a room wakes with no sockets", () => {
    const { room, deps } = publicRoom();
    room.join({});
    deps.advance(MIN);
    expect(room.syncConnections(new Set())).toBe(true);
    expect(room.state.idleSince).toBe(deps.now());
  });
});

describe("expiry labels", () => {
  it("formats time left", () => {
    expect(timeLeft(4 * HOUR + 12 * MIN + 30_000)).toBe("4h 13m");
    expect(timeLeft(6 * HOUR - 20_000)).toBe("6h");
    expect(timeLeft(12 * MIN)).toBe("12m");
    expect(timeLeft(2 * MIN + 59_000)).toBe("3m");
    expect(timeLeft(59_000)).toBe("under a minute");
    expect(timeLeft(-5)).toBe("under a minute");
  });

  it("warns once per threshold, only the tightest one reached", () => {
    expect(dueWarning(2 * HOUR, new Set())).toBeNull();
    expect(dueWarning(29 * MIN, new Set())).toBe(30);
    expect(dueWarning(29 * MIN, new Set([30]))).toBeNull();
    // Joining with 5 minutes left: just the 10-minute warning, not 30 as well.
    expect(dueWarning(5 * MIN, new Set())).toBe(10);
    expect(dueWarning(30_000, new Set([30, 10]))).toBe(1);
  });
});
