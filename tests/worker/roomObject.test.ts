import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, FakeState } from "./fakeRuntime";
import { RoomDurableObject } from "../../src/worker/roomObject";
import type { Env } from "../../src/worker/env";
import { CLOSE, type ClientMessage, type ServerMessage } from "../../src/shared/protocol";
import { RATE_LIMITS } from "../../src/shared/rateLimit";
import type { RoomState } from "../../src/shared/types";

const CODE = "TESTROOM";
const MINUTE = 60 * 1000;

/** A room Durable Object on the fake runtime, plus helpers to drive it like the runtime would. */
async function openRoom() {
  const ctx = new FakeState();
  const env = { INVITES: { idFromName: (name: string) => name, get: () => ({ updateRoom: async () => {} }) } };
  const room = new RoomDurableObject(ctx as unknown as DurableObjectState, env as unknown as Env);
  await room.init(CODE, { inviteId: "test-invite" });

  const join = async (query: Record<string, string>) => {
    await room.fetch(new Request(`https://room/${CODE}/ws?${new URLSearchParams(query)}`, { headers: { Upgrade: "websocket" } }));
    const ws = ctx.sockets.at(-1)!;
    ctx.ping(ws);
    return ws;
  };
  const send = (ws: FakeSocket, msg: ClientMessage) => room.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(msg));
  const players = () => (ctx.storage.data.get("state") as RoomState).players;

  /** Lets time pass, firing alarms as they come due. `alive` keep heartbeating; others are silent. */
  const wait = async (ms: number, alive: FakeSocket[]) => {
    const end = Date.now() + ms;
    let wakes = 0;
    for (let at = ctx.storage.alarm; at !== null && at <= end; at = ctx.storage.alarm) {
      vi.setSystemTime(at);
      for (const ws of alive) ctx.ping(ws);
      await room.alarm();
      wakes++;
    }
    vi.setSystemTime(end);
    for (const ws of alive) ctx.ping(ws);
    return wakes;
  };

  return { ctx, room, join, send, players, wait };
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
