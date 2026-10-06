import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchInvite, forgetInvite, loadInviteInfo, saveInvite } from "../src/client/invite";
import { fetchPublicStatus, loadPublicStatus } from "../src/client/publicRooms";
import type { InviteInfo } from "../src/shared/invites";

// Home lays out the last hosting answers this browser saw (publicRooms.ts, invite.ts) while fresh ones load.

const INFO: InviteInfo = {
  label: "friends",
  rooms: [{ code: "AAAAAA", phase: "drafting", players: ["Ann"], bots: 1, cubeName: "Vintage", cardCount: 540, createdAt: 1, lastActiveAt: 2 }],
  quota: { createdInWindow: 1, perWindow: 10, rooms: 1, maxRooms: 25, nextSlotAt: null },
};

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

/** Answers the next fetch with `body` when `answer` is called. */
function pendingFetch(body: unknown) {
  let answer!: () => void;
  const res = new Promise<Response>((resolve) => (answer = () => resolve(new Response(JSON.stringify(body)))));
  vi.stubGlobal("fetch", () => res);
  return () => answer();
}

describe("public status cache", () => {
  const NOW = 1_000_000;

  it("keeps what the last fetch said", async () => {
    expect(loadPublicStatus(NOW)).toBeNull();
    pendingFetch({ enabled: true, slots: 3, used: 1, nextFreeAt: null, nextRoomMs: 5, reopensAt: null, idleMs: 7, turnstileSiteKey: "site" })();
    await fetchPublicStatus();
    expect(loadPublicStatus(NOW)).toEqual({ enabled: true, slots: 3, used: 1, nextFreeAt: null, nextRoomMs: 5, reopensAt: null, idleMs: 7, turnstileSiteKey: "site" });
  });

  it("drops a full or booked pool's times once they've passed", () => {
    store.set("hyperdraft:public-status", JSON.stringify({ enabled: true, nextFreeAt: NOW - 1, reopensAt: NOW - 1 }));
    expect(loadPublicStatus(NOW)).toMatchObject({ nextFreeAt: null, reopensAt: null });
    store.set("hyperdraft:public-status", JSON.stringify({ enabled: true, nextFreeAt: NOW + 1, reopensAt: NOW + 1 }));
    expect(loadPublicStatus(NOW)).toMatchObject({ nextFreeAt: NOW + 1, reopensAt: NOW + 1 });
  });

  it("ignores a cache it can't read", () => {
    for (const raw of ["{not json", '"enabled"', "[]", "{}", '{"enabled":"yes"}']) {
      store.set("hyperdraft:public-status", raw);
      expect(loadPublicStatus(NOW)).toBeNull();
    }
    store.set("hyperdraft:public-status", JSON.stringify({ enabled: true, slots: "3", turnstileSiteKey: 4 }));
    expect(loadPublicStatus(NOW)).toMatchObject({ enabled: true, slots: undefined, turnstileSiteKey: null });
  });
});

describe("invite info cache", () => {
  it("keeps the saved invite's info, for that invite only", async () => {
    saveInvite("key-1");
    pendingFetch(INFO)();
    await fetchInvite("key-1");
    expect(loadInviteInfo("key-1")).toEqual(INFO);
    expect(loadInviteInfo("key-2")).toBeNull();
    expect(loadInviteInfo(null)).toBeNull();
  });

  it("doesn't keep info for a key that isn't the saved invite", async () => {
    pendingFetch(INFO)();
    await fetchInvite("key-1");
    expect(store.size).toBe(0);
  });

  it("keeps a forgotten invite forgotten, even with its info still in flight", async () => {
    saveInvite("key-1");
    const answer = pendingFetch(INFO);
    const fetching = fetchInvite("key-1");
    forgetInvite();
    answer();
    await fetching;
    expect(store.size).toBe(0);
  });

  it("ignores info it can't read", () => {
    saveInvite("key-1");
    const bad = [
      "{not json",
      JSON.stringify({ key: "key-1" }),
      JSON.stringify({ key: "key-1", info: { ...INFO, rooms: {} } }),
      JSON.stringify({ key: "key-1", info: { ...INFO, rooms: [{ ...INFO.rooms[0], players: undefined }] } }),
      JSON.stringify({ key: "key-1", info: { ...INFO, rooms: [{ ...INFO.rooms[0], phase: "napping" }] } }),
      JSON.stringify({ key: "key-1", info: { ...INFO, quota: { ...INFO.quota, nextSlotAt: "soon" } } }),
    ];
    for (const raw of bad) {
      store.set("hyperdraft:invite-info", raw);
      expect(loadInviteInfo("key-1")).toBeNull();
    }
  });
});
