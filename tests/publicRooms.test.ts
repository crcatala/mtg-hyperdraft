import { describe, expect, it } from "vitest";
import { durationLabel, emptyPool, poolStatus, PUBLIC_LIMITS, prunePool, publicBlocker, visitorPrefix, type PublicSlot } from "../src/shared/publicRooms";
import { TokenBucket } from "../src/shared/rateLimit";
import { createRoomState, Room } from "../src/shared/room";
import { dueWarning, timeLeft } from "../src/client/expiry";
import { testDeps } from "./fixtures";

const MIN = 60_000;
const HOUR = 60 * MIN;

function slot(code: string, createdAt: number, visitor = code.toLowerCase()): PublicSlot {
  return { code, createdAt, expiresAt: createdAt + PUBLIC_LIMITS.ttlMs, visitor };
}

describe("public room pool", () => {
  it("allows up to 3 rooms at once, then says when one frees up", () => {
    const now = 100 * HOUR;
    const pool = emptyPool();
    pool.slots = [slot("A", now - 5 * HOUR), slot("B", now - 2 * HOUR)];
    expect(publicBlocker(pool, "me", now)).toBeNull();
    expect(poolStatus(pool, "me", now)).toMatchObject({ slots: 3, used: 2, nextFreeAt: null, yours: null });

    pool.slots.push(slot("C", now - HOUR));
    const blocker = publicBlocker(pool, "me", now);
    expect(blocker?.status).toBe(429);
    expect(blocker?.error).toMatch(/All 3 public tables are in use.*in about 1h/);
    // A's hard expiry is the next guaranteed free slot.
    expect(poolStatus(pool, "me", now).nextFreeAt).toBe(now + HOUR);
  });

  it("frees slots at the hard expiry without anyone releasing them", () => {
    const now = 100 * HOUR;
    const pool = emptyPool();
    pool.slots = [slot("A", now - PUBLIC_LIMITS.ttlMs), slot("B", now - HOUR), slot("C", now - HOUR)];
    expect(poolStatus(pool, "me", now).used).toBe(2);
    expect(publicBlocker(pool, "me", now)).toBeNull();
    prunePool(pool, now);
    expect(pool.slots.map((s) => s.code)).toEqual(["B", "C"]);
  });

  it("gives each visitor one public room at a time", () => {
    const now = 100 * HOUR;
    const pool = emptyPool();
    pool.slots = [slot("A", now - HOUR, "sam")];
    expect(publicBlocker(pool, "sam", now)).toMatchObject({ status: 409, code: "A" });
    expect(poolStatus(pool, "sam", now).yours).toEqual({ code: "A", expiresAt: now + 5 * HOUR });
    expect(publicBlocker(pool, "jo", now)).toBeNull();
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
