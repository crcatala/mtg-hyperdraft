import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, FakeState } from "./fakeRuntime";
import { RoomDurableObject } from "../../src/worker/roomObject";
import type { Env } from "../../src/worker/env";
import { CLOSE, type ClientMessage, type ServerMessage } from "../../src/shared/protocol";
import { RATE_LIMITS } from "../../src/shared/rateLimit";
import { PUBLIC_LIMITS } from "../../src/shared/publicRooms";
import type { RoomState } from "../../src/shared/types";
import type { ImportResult, Room } from "../../src/shared/room";
import { basicIds, makeCube } from "../fixtures";

const CODE = "TESTROOM";
const MINUTE = 60 * 1000;

/** A room Durable Object on the fake runtime, plus helpers to drive it like the runtime would. */
async function openRoom(opts: { public?: boolean } = {}) {
  const ctx = new FakeState();
  const released: string[] = [];
  const env: Record<string, unknown> = {
    INVITES: { idFromName: (name: string) => name, get: () => ({ updateRoom: async () => {} }) },
    PUBLIC_POOL: { idFromName: (name: string) => name, get: () => ({ release: async (code: string) => void released.push(code) }) },
  };
  const make = () => new RoomDurableObject(ctx as unknown as DurableObjectState, env as unknown as Env);
  let room = make();
  await room.init(CODE, opts.public ? { expiresAt: Date.now() + PUBLIC_LIMITS.ttlMs } : { inviteId: "test-invite" });

  const join = async (query: Record<string, string>) => {
    await room.fetch(new Request(`https://room/${CODE}/ws?${new URLSearchParams(query)}`, { headers: { Upgrade: "websocket" } }));
    const ws = ctx.sockets.at(-1)!;
    ctx.ping(ws);
    return ws;
  };
  /** The runtime evicts a hibernating object and builds a new one over the same storage and sockets. */
  const hibernate = async () => {
    room = make();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const send = (ws: FakeSocket, msg: ClientMessage) => room.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(msg));
  const players = () => (ctx.storage.data.get("state") as RoomState).players;

  /** Lets time pass, firing alarms as they come due. `alive` keep heartbeating; others are silent. */
  const wakeLog: number[] = [];
  const wait = async (ms: number, alive: FakeSocket[]) => {
    const end = Date.now() + ms;
    let wakes = 0;
    for (let at = ctx.storage.alarm; at !== null && at <= end; at = ctx.storage.alarm) {
      vi.setSystemTime(at);
      for (const ws of alive) ctx.ping(ws);
      wakeLog.push(at);
      await room.alarm();
      wakes++;
    }
    vi.setSystemTime(end);
    for (const ws of alive) ctx.ping(ws);
    return wakes;
  };

  /** The runtime later delivers a close event for each socket the room closed; the fake doesn't, so tests do. */
  const deliverCloses = async () => {
    for (const ws of ctx.sockets) if (ws.closed) await room.webSocketClose(ws as unknown as WebSocket);
  };
  /** The pure room inside the Durable Object, to set up a draft or simulate a bug. */
  const engine = () => (room as unknown as { room: Room }).room;

  return { ctx, env, join, send, players, wait, wakeLog, deliverCloses, hibernate, released, engine };
}

function received(ws: FakeSocket): ServerMessage[] {
  return ws.sent.map((text) => JSON.parse(text) as ServerMessage);
}

function welcome(ws: FakeSocket) {
  const msg = received(ws).find((m) => m.t === "welcome");
  if (msg?.t !== "welcome") throw new Error("no welcome");
  return msg;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_800_000_000_000);
});
afterEach(() => vi.useRealTimers());

describe("room presence on the Durable Object", () => {
  it("notices a device that dies while the room is in use", async () => {
    const { join, players, wait } = await openRoom();
    const host = await join({ name: "Host" });
    const guest = await join({ name: "Guest" });

    await wait(150 * 1000, [guest]);

    expect(players().find((p) => p.id === welcome(host).you)?.connected).toBe(false);
    expect(players().find((p) => p.id === welcome(guest).you)?.isHost).toBe(true);
  });

  it("stops waking a quiet room after about ten sweeps", async () => {
    const { ctx, join, wait } = await openRoom();
    const a = await join({ name: "A" });
    const b = await join({ name: "B" });

    const wakes = await wait(60 * MINUTE, [a, b]);

    expect(wakes).toBeLessThanOrEqual(11);
    expect(ctx.storage.alarm).toBeNull();
  });

  it("settles presence when someone acts in a quiet room whose host died", async () => {
    const { ctx, join, send, players, wait } = await openRoom();
    const host = await join({ name: "Host" });
    const guest = await join({ name: "Guest" });
    await wait(15 * MINUTE, [host, guest]);
    expect(ctx.storage.alarm).toBeNull();

    // The host's device dies while the room sleeps: nothing notices yet.
    await wait(30 * MINUTE, [guest]);
    expect(players().find((p) => p.id === welcome(host).you)?.connected).toBe(true);

    // The guest's first message settles presence before it's handled, and wakes the sweeps again.
    await send(guest, { t: "setReady", ready: true });

    expect(players().find((p) => p.id === welcome(host).you)?.connected).toBe(false);
    expect(players().find((p) => p.id === welcome(guest).you)?.isHost).toBe(true);
    expect(ctx.storage.alarm).not.toBeNull();
  });

  it("keeps sweeping while players are active", async () => {
    const { ctx, join, send, wait } = await openRoom();
    const a = await join({ name: "A" });
    await wait(9 * MINUTE, [a]);
    await send(a, { t: "setReady", ready: true });

    await wait(9 * MINUTE, [a]);

    expect(ctx.storage.alarm).not.toBeNull();
  });
});

describe("quiet rooms and the Durable Object lifecycle", () => {
  it("settles presence when someone joins a quiet room whose host died", async () => {
    const { ctx, join, players, wait } = await openRoom();
    const host = await join({ name: "Host" });
    const guest = await join({ name: "Guest" });
    await wait(15 * MINUTE, [host, guest]);
    expect(ctx.storage.alarm).toBeNull();

    // The host's device dies while the room sleeps; a newcomer opens the link.
    await wait(30 * MINUTE, [guest]);
    expect(players().find((p) => p.id === welcome(host).you)?.connected).toBe(true);
    await join({ name: "Newcomer" });

    expect(players().find((p) => p.id === welcome(host).you)?.connected).toBe(false);
    expect(players().find((p) => p.id === welcome(guest).you)?.isHost).toBe(true);
  });

  it("keeps tracking activity and dead sockets after the object is evicted and woken", async () => {
    const { ctx, join, send, players, wait, hibernate } = await openRoom();
    const host = await join({ name: "Host" });
    const guest = await join({ name: "Guest" });
    await wait(5 * MINUTE, [host, guest]);
    await send(guest, { t: "setReady", ready: true });

    // Activity lives on the sockets, not in memory, so the woken object still sweeps.
    await hibernate();
    await wait(3 * MINUTE, [guest]);

    expect(players().find((p) => p.id === welcome(host).you)?.connected).toBe(false);
    expect(ctx.storage.alarm).not.toBeNull();
  });

  it("still lets the woken object go quiet once nobody acts", async () => {
    const { ctx, join, wait, hibernate } = await openRoom();
    const a = await join({ name: "A" });
    const b = await join({ name: "B" });
    await hibernate();

    const wakes = await wait(60 * MINUTE, [a, b]);

    expect(wakes).toBeLessThanOrEqual(11);
    expect(ctx.storage.alarm).toBeNull();
  });
});

describe("public rooms", () => {
  it("closes and frees its slot after a device dies in a room that had already gone quiet", async () => {
    const { ctx, join, wait, released } = await openRoom({ public: true });
    const player = await join({ name: "Solo" });
    // Idle with the tab open past the point where ordinary rooms stop sweeping...
    await wait(12 * MINUTE, [player]);
    expect(released).toEqual([]);

    // ...then the laptop sleeps: no close event ever arrives.
    await wait(PUBLIC_LIMITS.idleMs + 5 * MINUTE, []);

    expect(released).toEqual([CODE]);
    expect(ctx.storage.data.has("state")).toBe(false);
  });
});

describe("flood control on the Durable Object", () => {
  it("lets a quick burst of normal actions through", async () => {
    const { join, send } = await openRoom();
    const host = await join({ name: "Host" });

    for (let i = 0; i < 20; i++) await send(host, { t: "setReady", ready: i % 2 === 0 });

    expect(host.closed).toBeNull();
    expect(received(host).filter((m) => m.t === "error")).toEqual([]);
  });

  it("tells a flooding socket to slow down once, then closes it and holds its player out for a minute", async () => {
    const { join, send } = await openRoom();
    const host = await join({ name: "Host" });
    const flooder = await join({ name: "Flooder" });
    const { you, secret } = welcome(flooder);

    for (let i = 0; i < RATE_LIMITS.socket.capacity + RATE_LIMITS.floodDrops + 5; i++) await send(flooder, { t: "setReady", ready: i % 2 === 0 });

    expect(received(flooder).filter((m) => m.t === "error")).toHaveLength(1);
    expect(flooder.closed?.code).toBe(CLOSE.flood);
    expect(received(flooder)).toContainEqual(expect.objectContaining({ t: "closed", code: CLOSE.flood }));
    expect(host.closed).toBeNull();

    // Rejoining right away is refused; after the penalty it works.
    const refused = await join({ pid: you, secret });
    expect(refused.closed?.code).toBe(CLOSE.flood);
    vi.setSystemTime(Date.now() + RATE_LIMITS.penaltyMs + 1);
    const back = await join({ pid: you, secret });
    expect(back.closed).toBeNull();
    expect(welcome(back).you).toBe(you);
  });
});

function importResult(): ImportResult {
  const cards = Object.values(makeCube(400));
  return { name: "Test Cube", source: "test", cards, pool: cards.filter((c) => !c.id.startsWith("basic")).map((c) => c.id), notFound: [], warnings: [], basics: basicIds };
}

/** Two players in a draft with the given fixed pick timer, neither of them picking. */
async function timedDraft(pickTimerSec: number) {
  const opened = await openRoom();
  const a = await opened.join({ name: "A" });
  const b = await opened.join({ name: "B" });
  opened.engine().applyImport(importResult());
  await opened.send(a, { t: "config", draft: { pickTimerSec, timerStyle: "fixed" } });
  for (const ws of [a, b]) await opened.send(ws, { t: "setReady", ready: true });
  expect(opened.engine().state.phase).toBe("drafting");
  const picks = (ws: FakeSocket) => opened.engine().state.draft!.picks[welcome(ws).you].length;
  return { ...opened, a, b, picks };
}

describe("alarm guardrails", () => {
  it("never wakes more than once every 2 s, even if the room keeps asking to be woken right away", async () => {
    const { join, wait, wakeLog, engine } = await openRoom();
    const a = await join({ name: "A" });
    // A bug that always "advances" with a deadline already due would otherwise re-fire every 50 ms.
    const room = engine();
    room.tick = () => true;
    room.nextAlarm = () => Date.now();

    const wakes = await wait(10 * MINUTE, [a]);

    // The first wake is the presence sweep a minute in; from then on about one every 2 s: not more
    // (the cap), and not many fewer (the room still works).
    expect(wakes).toBeGreaterThanOrEqual(265);
    expect(wakes).toBeLessThanOrEqual(301);
    for (let i = 1; i < wakeLog.length; i++) expect(wakeLog[i] - wakeLog[i - 1]).toBeGreaterThanOrEqual(2000);
  });

  it("keeps the fastest allowed pick timer (1 s) going, auto-picking at most 2 s apart", async () => {
    const { a, b, picks, wait, wakeLog } = await timedDraft(1);

    await wait(MINUTE, [a, b]);

    // Without the gap that would be 60 picks each; with it, about 30, and never a stall.
    for (const ws of [a, b]) expect(picks(ws)).toBeGreaterThanOrEqual(29);
    for (let i = 1; i < wakeLog.length; i++) expect(wakeLog[i] - wakeLog[i - 1]).toBeLessThanOrEqual(2000);
  });

  it("leaves normal pick timers exactly on time", async () => {
    const { a, b, picks, wait, wakeLog, engine } = await timedDraft(30);
    const deadline = engine().nextAlarm()!;

    await wait(31 * 1000, [a, b]);

    expect(wakeLog).toContain(deadline);
    for (const ws of [a, b]) expect(picks(ws)).toBe(1);
  });

  it("turns off rooms that are already running when the kill switch is flipped, and they come back after", async () => {
    const { ctx, env, join, send, wait, deliverCloses } = await openRoom();
    const a = await join({ name: "A" });
    const b = await join({ name: "B" });
    expect(ctx.storage.alarm).not.toBeNull();

    env.ONLINE_ENABLED = "false";
    await wait(2 * MINUTE, [a, b]);
    for (const ws of [a, b]) expect(ws.closed?.code).toBe(CLOSE.offline);
    // The close events that follow must not re-arm the alarm.
    await deliverCloses();
    expect(ctx.storage.alarm).toBeNull();
    // The room is kept, so it picks up again when online rooms come back.
    expect(ctx.storage.data.has("state")).toBe(true);

    delete env.ONLINE_ENABLED;
    const back = await join({ pid: welcome(a).you, secret: welcome(a).secret });
    expect(back.closed).toBeNull();
    expect(ctx.storage.alarm).not.toBeNull();
    await send(back, { t: "setReady", ready: true });
    expect(back.closed).toBeNull();
  });

  it("stops a looping room for good when the kill switch is flipped", async () => {
    const { ctx, env, join, wait, deliverCloses, engine } = await openRoom();
    const a = await join({ name: "A" });
    const room = engine();
    room.tick = () => true;
    room.nextAlarm = () => Date.now();
    expect(await wait(2 * MINUTE, [a])).toBeGreaterThan(20);

    env.ONLINE_ENABLED = "false";
    await wait(10 * 1000, [a]);
    // Close events, a reconnecting constructor or a stray message all schedule through the same place.
    await deliverCloses();

    expect(ctx.storage.alarm).toBeNull();
    expect(await wait(10 * MINUTE, [])).toBe(0);
  });

  it("closes a socket that sends a message after the switch is flipped, before any alarm fires", async () => {
    const { env, join, send } = await openRoom();
    const a = await join({ name: "A" });

    env.ONLINE_ENABLED = "false";
    await send(a, { t: "setReady", ready: true });

    expect(a.closed?.code).toBe(CLOSE.offline);
  });

  it("still closes a public room on time and frees its slot while the switch is off", async () => {
    const { ctx, env, join, wait, deliverCloses, released } = await openRoom({ public: true });
    const player = await join({ name: "Solo" });

    env.ONLINE_ENABLED = "false";
    await wait(2 * MINUTE, [player]);
    await deliverCloses();
    await wait(PUBLIC_LIMITS.idleMs + 5 * MINUTE, []);

    expect(released).toEqual([CODE]);
    expect(ctx.storage.data.has("state")).toBe(false);
  });
});
