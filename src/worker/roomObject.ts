// One Durable Object per room. Thin shell around the pure `Room` engine:
// websockets (hibernation API), persistence to DO storage, alarms for pick timers and public-room
// expiry, cube imports, flood control, and summaries pushed to the invite that owns the room
// ("My rooms").

import { DurableObject } from "cloudflare:workers";
import { inviteStub, OFFLINE_MESSAGE, onlineEnabled, publicPoolStub, type Env } from "./env";
import { CLOSE, clientMessageSchema, type ClientMessage, type ServerMessage } from "../shared/protocol";
import { createRoomState, Room, RoomError, SeatClaimNeeded, type RoomOwner } from "../shared/room";
import { FloodControl } from "../shared/rateLimit";
import { presenceSweepAt } from "../shared/presence";
import { durationLabel, PUBLIC_LIMITS } from "../shared/publicRooms";
import type { CardData, CardMap, RoomState } from "../shared/types";
import { importCube } from "../shared/importCube";
import { cryptoRng } from "../shared/rng";

interface Attachment {
  playerId: string;
  /**
   * This socket's own id. The socket handed to webSocketClose is a different object from the one
   * getWebSockets() returns (and still reads as OPEN there), so sockets are told apart by this.
   */
  sid?: string;
  /** When the socket joined (counts as its first sign of life, before any heartbeat). */
  since?: number;
  /** When this socket last sent a message (heartbeats don't count): keeps presence sweeps going. */
  active?: number;
  /** Closed by the heartbeat sweep; its close event may never arrive, so ignore it from now on. */
  stale?: boolean;
}

/** The last summary sent to the invite ledger, so unchanged summaries aren't re-sent. */
interface Pushed {
  key: string;
  at: number;
}

const CARD_CHUNK = 150; // Cards per storage key (values must stay well under 2 MB).
/** Activity alone (no summary change) refreshes "last active" at most this often. */
const ACTIVITY_PUSH_MS = 30 * 60 * 1000;
/** If a pick deadline has passed but a tick couldn't advance the draft, retry this much later. */
const STUCK_ALARM_BACKOFF_MS = 60 * 1000;
/**
 * Backstop against an alarm loop: the alarm never fires within this long of its last wake-up, whatever
 * the draft or presence logic asks for. A bug that keeps asking for "now" then costs one wake (a request
 * and a write or two) every 2 s, about 43,000 a day, instead of one every 50 ms (1.7 million). Honest
 * play doesn't notice: one wake auto-picks every overdue seat, so on the fastest allowed timer (1 s,
 * fixed) auto-picks land at most 2 s late, and other deadlines are seconds to minutes apart. Why a gap
 * and not "N per minute": see docs/architecture.md, "Alarm backstops".
 */
const MIN_ALARM_GAP_MS = 2000;
/**
 * Clients send a raw "ping" every 10 s, answered by the runtime without waking this object. A socket
 * with no ping for this long is treated as gone (sleeping laptop, dropped Wi-Fi: no close event
 * ever arrives). Generous because browsers throttle timers in background tabs to once a minute.
 */
const HEARTBEAT_STALE_MS = 90 * 1000;
/** A message refreshes the socket's "last active" stamp at most this often: drags send up to 20 a second. */
const ACTIVE_REFRESH_MS = 30 * 1000;
/** Messages and joins settle presence first, but no more often than this. */
const SWEEP_ON_MESSAGE_MS = 5 * 1000;
/** Messages that never change room state, so they don't spend the room's write budget. */
const STATELESS: ReadonlySet<ClientMessage["t"]> = new Set(["ping", "drag", "point", "poke", "emote", "petMove", "petCancel", "vend"]);
const FLOOD_MESSAGE = "You were disconnected for sending too many messages. Wait a minute, then reload to rejoin.";

export class RoomDurableObject extends DurableObject<Env> {
  private room: Room | null = null;
  private pushed: Pushed = { key: "", at: 0 };
  /** Flood control, in memory only (see shared/rateLimit.ts). */
  private flood = new FloodControl(Date.now());
  /** When presence was last settled (in memory: a room that just woke has not). */
  private sweptAt = 0;
  /**
   * When the alarm last fired, for MIN_ALARM_GAP_MS. Memory is enough: an object is only evicted after
   * ~10 s idle, longer than the gap, so a fresh object starting from 0 can't wake faster than allowed.
   */
  private lastWakeAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeats are answered by the runtime itself, so they don't wake a hibernating room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    // With hibernation the constructor runs on every wake-up, so keep this to a couple of reads.
    ctx.blockConcurrencyWhile(async () => {
      const head = await ctx.storage.get<unknown>(["state", "cardChunks", "pushed"]);
      const state = head.get("state") as RoomState | undefined;
      if (!state) return;
      const chunks = (head.get("cardChunks") as number | undefined) ?? 0;
      this.pushed = (head.get("pushed") as Pushed | undefined) ?? this.pushed;
      const cards: CardMap = {};
      if (chunks > 0) {
        const stored = await ctx.storage.get<CardData[]>(Array.from({ length: chunks }, (_, i) => `cards:${i}`));
        for (const list of stored.values()) for (const c of list) cards[c.id] = c;
      }
      this.room = new Room(state, cards, { now: () => Date.now(), rng: cryptoRng });

      // Sockets can drop without close events (deploys, restarts). Trust the sockets we still hold.
      const here = new Set(this.liveSockets().map((ws) => (ws.deserializeAttachment() as Attachment).playerId));
      if (this.room.syncConnections(here)) {
        await this.saveState();
        await this.scheduleAlarm();
        this.broadcastState();
      }
    });
  }

  // --- RPC (called by the Worker and the invite ledger) ------------------------------------------

  /** Creates the room. Returns false if this code is already in use. */
  async init(code: string, owner: RoomOwner): Promise<boolean> {
    if (this.room) return false;
    this.room = new Room(createRoomState(code, Date.now(), owner), {}, { now: () => Date.now(), rng: cryptoRng });
    await this.saveState();
    // Public rooms close on their own: until someone joins, that's the idle deadline.
    await this.scheduleAlarm();
    return true;
  }

  /** For the public pool: is this room still open? Closes it first if it's past its deadline. */
  async publicAlive(): Promise<boolean> {
    if (!this.room) return false;
    return !(await this.closeIfDue());
  }

  /** Deletes the room: closes sockets and wipes storage, after which Cloudflare drops the object. */
  async destroy(closeCode: number = CLOSE.deleted, reason = "room deleted"): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      if (closeCode === CLOSE.deleted) this.sendTo(ws, { t: "closed", code: CLOSE.deleted, message: "This room was deleted." });
      try {
        ws.close(closeCode, reason);
      } catch {
        /* already closing */
      }
    }
    this.room = null;
    this.pushed = { key: "", at: 0 };
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // --- HTTP + websockets -----------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const [code, action] = url.pathname.split("/").filter(Boolean);

    // A public room whose alarm hasn't fired yet (they can run late) is closed here instead.
    await this.closeIfDue();

    if (action === "info") {
      if (!this.room) return Response.json({ error: "No such room." }, { status: 404 });
      const s = this.room.state;
      return Response.json({ code: s.code, phase: s.phase, players: s.players.filter((p) => !p.isBot).length, cube: s.cube?.name ?? null });
    }

    if (action === "ws") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);

      if (!this.room) {
        this.sendTo(server, { t: "closed", code: CLOSE.notFound, message: `Room ${code} doesn't exist. Check the code?` });
        server.close(CLOSE.notFound, "no such room");
        return new Response(null, { status: 101, webSocket: client });
      }

      // A player just closed for flooding waits out the penalty before rejoining.
      const rejoining = url.searchParams.get("pid") ?? url.searchParams.get("claim");
      if (rejoining && this.flood.penalized(rejoining, Date.now())) {
        this.sendTo(server, { t: "closed", code: CLOSE.flood, message: FLOOD_MESSAGE });
        server.close(CLOSE.flood, "too many messages");
        return new Response(null, { status: 101, webSocket: client });
      }

      // Sweeps stop in a quiet room, so a seat whose device died meanwhile still reads as taken.
      // Settle that first, or the joiner can't claim it.
      await this.sweepStaleSockets();

      try {
        const joined = this.room.join({
          playerId: url.searchParams.get("pid") ?? undefined,
          secret: url.searchParams.get("secret") ?? undefined,
          name: url.searchParams.get("name") ?? undefined,
          avatar: url.searchParams.get("avatar") ?? undefined,
          companion: url.searchParams.get("companion") ?? undefined,
          claim: url.searchParams.get("claim") ?? undefined,
        });
        server.serializeAttachment({ playerId: joined.playerId, sid: crypto.randomUUID(), since: Date.now() } satisfies Attachment);
        this.sendTo(server, { t: "welcome", you: joined.playerId, secret: joined.secret, code: this.room.state.code });
        this.sendTo(server, { t: "cards", cards: this.room.cards });
        await this.saveState();
        this.broadcastState();
        await this.scheduleAlarm();
        await this.pushSummary(true);
      } catch (err) {
        if (err instanceof SeatClaimNeeded) {
          this.sendTo(server, { t: "claim", seats: err.seats });
          server.close(CLOSE.claim, "pick a seat");
        } else {
          const message = err instanceof RoomError ? err.message : "Could not join the room.";
          this.sendTo(server, { t: "error", message });
          server.close(CLOSE.refused, "join refused");
        }
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (await this.closeIfDue()) return;
    if (await this.closeIfOffline()) return;
    const room = this.room;
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!room || !att) return;

    let parsed;
    try {
      parsed = clientMessageSchema.safeParse(JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data)));
    } catch {
      return this.sendTo(ws, { t: "error", message: "Malformed message." });
    }
    if (!parsed.success) return this.sendTo(ws, { t: "error", message: "Invalid message." });
    if (!this.allow(ws, att, parsed.data)) return;
    const now = Date.now();
    if (parsed.data.t !== "ping" && now - (att.active ?? 0) >= ACTIVE_REFRESH_MS) ws.serializeAttachment({ ...att, active: now } satisfies Attachment);
    // After a quiet spell (no sweeps) a dead device may still hold a seat: settle presence before acting.
    if (now - this.sweptAt >= SWEEP_ON_MESSAGE_MS) await this.sweepStaleSockets();

    const result = room.handle(att.playerId, parsed.data);
    for (const out of result.outbound) {
      if (out.to === "self") this.sendTo(ws, out.msg);
      else if (out.to === "player") this.sendToPlayer(out.playerId, out.msg);
      else this.sendToOthers(att.playerId, out.msg);
    }
    if (result.changed) {
      await this.saveState();
      this.broadcastState();
      await this.scheduleAlarm();
      await this.pushSummary(true);
    } else {
      // Any message makes a quiet room active again: start the presence sweeps.
      await this.scheduleAlarm();
    }
    if (result.importSource) void this.runImport(result.importSource);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws);
  }

  private async handleDisconnect(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!this.room || !att) return;
    if (att.sid) this.flood.forget(att.sid);
    // It can linger in getWebSockets() for a while: stop counting it as live.
    try {
      ws.serializeAttachment({ ...att, stale: true } satisfies Attachment);
    } catch {
      /* already gone */
    }
    // Another open socket for the same player (a second tab) keeps them connected.
    const stillConnected = this.liveSockets().some((s) => {
      const other = s.deserializeAttachment() as Attachment;
      return other.playerId === att.playerId && other.sid !== att.sid;
    });
    if (!stillConnected && this.room.setConnected(att.playerId, false)) {
      await this.saveState();
      this.broadcastState();
      // The last human leaving pauses the pick clock, which clears the alarm.
      await this.scheduleAlarm();
      await this.pushSummary(true);
    }
  }

  /** Sockets that are still in play: attached to a player and not given up on by the sweep. */
  private liveSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      const att = ws.deserializeAttachment() as Attachment | null;
      return !!att?.playerId && !att.stale;
    });
  }

  /** Closes sockets that stopped sending heartbeats and marks their players as disconnected. */
  private async sweepStaleSockets() {
    const now = Date.now();
    this.sweptAt = now;
    for (const ws of this.liveSockets()) {
      const att = ws.deserializeAttachment() as Attachment;
      const heard = Math.max(this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0, att.since ?? 0, att.active ?? 0);
      if (now - heard < HEARTBEAT_STALE_MS) continue;
      try {
        ws.serializeAttachment({ ...att, stale: true } satisfies Attachment);
        // Not a 4xxx code: if the client is somehow still there, it should reconnect.
        ws.close(1001, "heartbeat timeout");
      } catch {
        /* already closing */
      }
      await this.handleDisconnect(ws);
    }
  }

  async alarm(): Promise<void> {
    if (!this.room) return;
    this.lastWakeAt = Date.now();
    if (await this.closeIfDue()) return;
    if (await this.closeIfOffline()) return;
    await this.sweepStaleSockets();
    const progressed = this.room.tick();
    if (progressed) {
      await this.saveState();
      this.broadcastState();
      await this.pushSummary(false);
    }
    await this.scheduleAlarm(progressed);
  }

  // --- public-room expiry + flood control -----------------------------------------------------

  /**
   * The kill switch (ONLINE_ENABLED=false) for rooms that are already running: the Worker only stops
   * new requests, while alarms (which survive the redeploy that flipping the switch causes) and open
   * sockets reach this object directly. Closes the sockets and lets scheduleAlarm, which also checks
   * the switch, drop pick timers and presence checks. The room is kept, so it carries on when online
   * rooms are turned back on; a public room still closes at its deadline and frees its slot.
   */
  private async closeIfOffline(): Promise<boolean> {
    if (onlineEnabled(this.env)) return false;
    for (const ws of this.ctx.getWebSockets()) {
      this.sendTo(ws, { t: "closed", code: CLOSE.offline, message: OFFLINE_MESSAGE });
      try {
        ws.close(CLOSE.offline, "online rooms off");
      } catch {
        /* already closing */
      }
    }
    await this.scheduleAlarm();
    return true;
  }

  /**
   * Closes a public room that has reached its deadline (hard expiry, or idle for too long): tells
   * everyone, deletes the room, and hands its slot back to the pool. Returns true if it closed.
   */
  private async closeIfDue(): Promise<boolean> {
    const closeAt = this.room?.closeAt() ?? null;
    if (closeAt === null || closeAt > Date.now()) return false;
    const code = this.room!.state.code;
    const timedOut = closeAt >= this.room!.state.expiresAt!;
    const message = timedOut
      ? "This public room reached its closing time."
      : `This public room closed because nobody was in it for ${durationLabel(PUBLIC_LIMITS.idleMs)}.`;
    for (const ws of this.ctx.getWebSockets()) this.sendTo(ws, { t: "closed", code: CLOSE.expired, message });
    await this.destroy(CLOSE.expired, "room expired");
    console.log(`Closed public room ${code} (${timedOut ? "time limit" : "idle"})`);
    try {
      await publicPoolStub(this.env).release(code);
    } catch (err) {
      // The pool frees the slot on its own at the hard expiry, or when it next checks on its rooms.
      console.error(`Room ${code}: could not release its public slot`, err);
    }
    return true;
  }

  /**
   * Flood control (see shared/rateLimit.ts). Over budget, the message is dropped and the sender told
   * to slow down, at most every few seconds; a socket that keeps flooding is closed.
   */
  private allow(ws: WebSocket, att: Attachment, msg: ClientMessage): boolean {
    const sid = att.sid ?? att.playerId;
    const { verdict, notice } = this.flood.check(sid, att.playerId, !STATELESS.has(msg.t), Date.now());
    if (verdict === "ok") return true;
    if (notice) this.sendTo(ws, { t: "error", message: "Whoa, too many actions at once. Give it a second." });
    if (verdict === "close") {
      console.warn(`Room ${this.room?.state.code}: closed a flooding socket (player ${att.playerId})`);
      this.sendTo(ws, { t: "closed", code: CLOSE.flood, message: FLOOD_MESSAGE });
      try {
        ws.close(CLOSE.flood, "too many messages");
      } catch {
        /* already closing */
      }
      void this.handleDisconnect(ws);
    }
    return false;
  }

  // --- imports --------------------------------------------------------------------------------

  private async runImport(source: string) {
    const room = this.room!;
    try {
      const result = await importCube(
        source,
        fetch,
        (message) => {
          room.setImportProgress(message);
          this.broadcastState();
        },
        (path) => this.env.ASSETS.fetch(new URL(path, "https://assets.local")),
      );
      room.applyImport(result);
      await this.saveCards();
    } catch (err) {
      room.failImport(err instanceof Error ? err.message : "Import failed.");
    }
    await this.saveState();
    this.broadcast({ t: "cards", cards: room.cards });
    this.broadcastState();
    await this.pushSummary(true);
  }

  // --- persistence + messaging ----------------------------------------------------------------

  private async saveState() {
    if (this.room) await this.ctx.storage.put("state", this.room.state);
  }

  private async saveCards() {
    const cards = Object.values(this.room!.cards);
    const chunks: Record<string, CardData[]> = {};
    for (let i = 0; i * CARD_CHUNK < cards.length; i++) chunks[`cards:${i}`] = cards.slice(i * CARD_CHUNK, (i + 1) * CARD_CHUNK);
    const old = (await this.ctx.storage.get<number>("cardChunks")) ?? 0;
    const count = Object.keys(chunks).length;
    await this.ctx.storage.put({ ...chunks, cardChunks: count });
    if (old > count) await this.ctx.storage.delete(Array.from({ length: old - count }, (_, i) => `cards:${count + i}`));
  }

  /**
   * Keeps the storage alarm in line with the next pick deadline. Only writes when it changes
   * (every setAlarm/deleteAlarm is a billed write). `progressed` = false means the last tick did
   * nothing: if a deadline is still overdue, back off instead of re-firing every few milliseconds.
   * The only place that sets the alarm (tests/tooling/alarmCalls.test.ts keeps it that way).
   */
  private async scheduleAlarm(progressed = true) {
    const current = await this.ctx.storage.getAlarm();
    const now = Date.now();
    const closeAt = this.room?.closeAt() ?? null;
    // Kill switch on: no pick timers or presence checks (whoever calls this: a late close event, the
    // constructor), only a public room's closing time, so its slot and storage are still freed.
    let next = onlineEnabled(this.env)
      ? this.nextWake(current, now, closeAt, progressed)
      : closeAt === null ? null : Math.max(closeAt, now + 50);
    if (next !== null) next = Math.max(next, this.lastWakeAt + MIN_ALARM_GAP_MS);
    if (next === current) return;
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  /** The earliest of the next pick deadline, presence sweep and public closing time, or null. */
  private nextWake(current: number | null, now: number, closeAt: number | null, progressed: boolean): number | null {
    let next = this.room?.nextAlarm() ?? null;
    if (next !== null) {
      if (!progressed && next <= now) {
        console.warn(`Room ${this.room?.state.code}: pick deadline overdue but nothing advanced; backing off.`);
        next = now + STUCK_ALARM_BACKOFF_MS;
      } else {
        next = Math.max(next, now + 50);
      }
    }
    // While the room is in use, wake up now and then to catch silently dropped sockets. They stop
    // once nobody has joined or sent a message for a while (see shared/presence.ts), so a tab left
    // open overnight lets the room hibernate.
    const live = this.liveSockets();
    const lastActivity = Math.max(0, ...live.map((ws) => {
      const att = ws.deserializeAttachment() as Attachment;
      return Math.max(att.active ?? 0, att.since ?? 0);
    }));
    // Public rooms never go quiet: a silently dead last player must still start the idle countdown, or
    // the room would hold one of the few public slots until its hard expiry. They are capped at a few
    // rooms of a few hours, so this stays a small, bounded number of wake-ups.
    const sweep = presenceSweepAt(current, now, live.length, closeAt !== null ? now : lastActivity);
    if (sweep !== null) next = next === null ? sweep : Math.min(next, sweep);
    // Public rooms close on time even if nothing else would wake them.
    if (closeAt !== null) next = next === null ? Math.max(closeAt, now + 50) : Math.min(next, Math.max(closeAt, now + 50));
    return next;
  }

  /**
   * Tells the invite ledger about this room when its summary changes (players, phase, cube), or
   * on activity at most every ACTIVITY_PUSH_MS. Best effort: failures only cost freshness.
   */
  private async pushSummary(activity: boolean) {
    const room = this.room;
    const inviteId = room?.state.inviteId;
    if (!room || !inviteId) return;
    const summary = room.summary();
    const key = JSON.stringify(summary);
    const now = Date.now();
    if (key === this.pushed.key && !(activity && now - this.pushed.at >= ACTIVITY_PUSH_MS)) return;
    this.pushed = { key, at: now };
    try {
      await this.ctx.storage.put("pushed", this.pushed);
      await inviteStub(this.env, inviteId).updateRoom(inviteId, room.state.code, summary, now);
    } catch (err) {
      console.error(`Room ${room.state.code}: could not update invite ledger`, err);
    }
  }

  private sendTo(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket already closing; the close handler will clean up.
    }
  }

  private broadcast(msg: ServerMessage) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        /* closing */
      }
    }
  }

  private sendToOthers(playerId: string, msg: ServerMessage) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment | null)?.playerId === playerId) continue;
      try {
        ws.send(text);
      } catch {
        /* closing */
      }
    }
  }

  private sendToPlayer(playerId: string, msg: ServerMessage) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment | null)?.playerId !== playerId) continue;
      try {
        ws.send(text);
      } catch {
        /* closing */
      }
    }
  }

  private broadcastState() {
    if (!this.room) return;
    const views = new Map<string, string>();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att) continue;
      let text = views.get(att.playerId);
      if (!text) {
        text = JSON.stringify({ t: "state", view: this.room.viewFor(att.playerId) } satisfies ServerMessage);
        views.set(att.playerId, text);
      }
      try {
        ws.send(text);
      } catch {
        /* closing */
      }
    }
  }
}
