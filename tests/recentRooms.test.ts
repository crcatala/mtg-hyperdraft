import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetRoom, isRoomGone, loadRecent, mergeRooms, pruneRecent, RECENT_LIMITS, rememberRoom, snapshotOf, upsertRecent, type RecentRoom } from "../src/client/recentRooms";
import type { RoomRecord } from "../src/shared/invites";
import { CLOSE, type RoomView } from "../src/shared/protocol";

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function recent(code: string, seenAt: number, extra: Partial<RecentRoom> = {}): RecentRoom {
  return { code, hosted: false, seenAt, phase: "lobby", players: ["Ana"], bots: 0, cubeName: null, cardCount: 0, expiresAt: null, ...extra };
}

function record(code: string, lastActiveAt: number, extra: Partial<RoomRecord> = {}): RoomRecord {
  return { code, createdAt: lastActiveAt - HOUR, lastActiveAt, phase: "drafting", players: ["Host", "Ana"], bots: 2, cubeName: "Vintage", cardCount: 540, ...extra };
}

describe("recent rooms list", () => {
  it("snapshots what the list shows from a room view", () => {
    const view = {
      code: "ABC123",
      phase: "deckbuilding",
      players: [
        { id: "u1", name: "Ana", isBot: false },
        { id: "b1", name: "Bot", isBot: true },
        { id: "u2", name: "Ben", isBot: false },
      ],
      cube: { name: "Pauper", size: 360 },
      expiresAt: NOW + HOUR,
    } as unknown as RoomView;
    expect(snapshotOf(view)).toEqual({ phase: "deckbuilding", players: ["Ana", "Ben"], bots: 1, cubeName: "Pauper", cardCount: 360, expiresAt: NOW + HOUR });
  });

  it("puts the room just seen first, refreshing what's known and keeping it hosted", () => {
    const list = [recent("AAAAAA", NOW - 2 * HOUR, { hosted: true }), recent("BBBBBB", NOW - HOUR)];
    const out = upsertRecent(list, "AAAAAA", { phase: "playing", hosted: false }, NOW);
    expect(out.map((r) => r.code)).toEqual(["AAAAAA", "BBBBBB"]);
    expect(out[0]).toMatchObject({ phase: "playing", hosted: true, seenAt: NOW, players: ["Ana"] });
  });

  it("adds a room it hasn't seen with defaults", () => {
    const [room] = upsertRecent([], "NEWONE", { hosted: true }, NOW);
    expect(room).toEqual({ code: "NEWONE", hosted: true, seenAt: NOW, phase: "lobby", players: [], bots: 0, cubeName: null, cardCount: 0, expiresAt: null });
  });

  it("drops closed public rooms and long-unseen rooms, and keeps only the newest few", () => {
    const list = [
      recent("CLOSED", NOW - HOUR, { expiresAt: NOW - 1 }),
      recent("PUBLIC", NOW - HOUR, { expiresAt: NOW + HOUR }),
      recent("STALE1", NOW - RECENT_LIMITS.maxAgeMs),
      ...Array.from({ length: RECENT_LIMITS.maxRooms + 2 }, (_, i) => recent(`ROOM${i}`, NOW - i * 1000)),
    ];
    const out = pruneRecent(list, NOW);
    expect(out).toHaveLength(RECENT_LIMITS.maxRooms);
    expect(out.map((r) => r.code)).not.toContain("CLOSED");
    expect(out.map((r) => r.code)).not.toContain("STALE1");
    expect(out[0].code).toBe("ROOM0");
    expect(out.every((r, i) => i === 0 || out[i - 1].seenAt >= r.seenAt)).toBe(true);
  });

  it("caps hosted and joined rooms apart, so hosting a run of rooms can't push out a friend's", () => {
    const friend = recent("FRIEND", NOW - HOUR);
    const hosted = Array.from({ length: RECENT_LIMITS.maxRooms + 3 }, (_, i) => recent(`HOST${i}`, NOW - i * 1000, { hosted: true }));
    const out = pruneRecent([friend, ...hosted], NOW);
    expect(out.map((r) => r.code)).toContain("FRIEND");
    expect(out.filter((r) => r.hosted)).toHaveLength(RECENT_LIMITS.maxRooms);
    expect(out.filter((r) => r.hosted).map((r) => r.code)).toEqual(hosted.slice(0, RECENT_LIMITS.maxRooms).map((r) => r.code));
  });

  it("forgets a room only when the server says the room itself is gone", () => {
    for (const code of [CLOSE.notFound, CLOSE.deleted, CLOSE.expired]) expect(isRoomGone(code), `close ${code}`).toBe(true);
    // Refusals, floods and outages leave the room open: keep it on the list.
    for (const code of [CLOSE.refused, CLOSE.claim, CLOSE.flood, CLOSE.offline, 1000, 1001, 1006]) expect(isRoomGone(code), `close ${code}`).toBe(false);
  });

  it("merges an invite's ledger with this browser's rooms, tagging who hosted what", () => {
    const ledger = [record("INVITE", NOW - 3 * HOUR), record("SHARED", NOW - 5 * HOUR)];
    const local = [
      recent("FRIEND", NOW - HOUR),
      recent("SHARED", NOW - 2 * HOUR, { phase: "lobby", players: ["Old snapshot"] }),
      recent("PUBLIC", NOW - 4 * HOUR, { hosted: true, expiresAt: NOW + HOUR }),
    ];
    const out = mergeRooms(ledger, local);
    expect(out.map((r) => [r.code, r.role, r.onInvite])).toEqual([
      ["FRIEND", "joined", false],
      ["SHARED", "hosted", true],
      ["INVITE", "hosted", true],
      ["PUBLIC", "hosted", false],
    ]);
    // The ledger's details win (the server's are fresher); the last visit here still counts as activity.
    const shared = out.find((r) => r.code === "SHARED")!;
    expect(shared).toMatchObject({ phase: "drafting", players: ["Host", "Ana"], activeAt: NOW - 2 * HOUR, createdAt: NOW - 6 * HOUR });
    expect(out.find((r) => r.code === "PUBLIC")).toMatchObject({ expiresAt: NOW + HOUR, createdAt: null });
  });
});

describe("recent rooms storage", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    vi.stubGlobal("location", { search: "" });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("remembers and forgets rooms", () => {
    rememberRoom("AAAAAA", { hosted: true });
    rememberRoom("BBBBBB", { phase: "drafting" });
    expect(loadRecent().map((r) => [r.code, r.hosted, r.phase])).toEqual([
      ["BBBBBB", false, "drafting"],
      ["AAAAAA", true, "lobby"],
    ]);
    forgetRoom("AAAAAA");
    expect(loadRecent().map((r) => r.code)).toEqual(["BBBBBB"]);
  });

  it("keeps a separate list per ?as= alias", () => {
    rememberRoom("AAAAAA");
    vi.stubGlobal("location", { search: "?as=2" });
    expect(loadRecent()).toEqual([]);
    rememberRoom("BBBBBB");
    expect(loadRecent().map((r) => r.code)).toEqual(["BBBBBB"]);
    expect([...store.keys()].sort()).toEqual(["hyperdraft:recent", "hyperdraft:recent:2"]);
  });

  it("shrugs off corrupt or foreign data", () => {
    store.set("hyperdraft:recent", "{not json");
    expect(loadRecent()).toEqual([]);
    store.set("hyperdraft:recent", JSON.stringify([{ code: 5 }, null, { code: "NOSEEN" }, recent("GOODONE", Date.now())]));
    expect(loadRecent().map((r) => r.code)).toEqual(["GOODONE"]);
  });

  it("fills in missing or unknown fields instead of dropping the room", () => {
    const seenAt = Date.now();
    store.set("hyperdraft:recent", JSON.stringify([{ code: "OLDFMT1", seenAt, phase: "sealed", players: ["Ana", 7], hosted: "yes" }]));
    expect(loadRecent()).toEqual([{ code: "OLDFMT1", hosted: false, seenAt, phase: "lobby", players: ["Ana"], bots: 0, cubeName: null, cardCount: 0, expiresAt: null }]);
  });

  it("works without storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(() => rememberRoom("AAAAAA")).not.toThrow();
    expect(loadRecent()).toEqual([]);
  });
});
