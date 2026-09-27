// One Durable Object per room. Thin shell around the pure `Room` engine:
// websockets (hibernation API), persistence to DO storage, alarms for pick timers, cube imports,
// and summaries pushed to the invite that owns the room ("My rooms").

import { DurableObject } from "cloudflare:workers";
import { inviteStub, type Env } from "./env";
import { CLOSE, clientMessageSchema, type ServerMessage } from "../shared/protocol";
import { createRoomState, Room, RoomError, SeatClaimNeeded } from "../shared/room";
import type { CardData, CardMap, RoomState } from "../shared/types";
import { importCube } from "../shared/importCube";

interface Attachment {
  playerId: string;
  /**
   * This socket's own id. The socket handed to webSocketClose is a different object from the one
   * getWebSockets() returns (and still reads as OPEN there), so sockets are told apart by this.
   */
  sid?: string;
  /** When the socket joined (counts as its first sign of life, before any heartbeat). */
  since?: number;
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
 * Clients send a raw "ping" every 10 s, answered by the runtime without waking this object. A socket
 * with no ping for this long is treated as gone (sleeping laptop, dropped Wi-Fi: no close event
 * ever arrives). Generous because browsers throttle timers in background tabs to once a minute.
 */
const HEARTBEAT_STALE_MS = 90 * 1000;
/** How often to look for stale sockets while anyone is connected. */
const PRESENCE_SWEEP_MS = 30 * 1000;

export class RoomDurableObject extends DurableObject<Env> {
  private room: Room | null = null;
  private pushed: Pushed = { key: "", at: 0 };

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
      this.room = new Room(state, cards, { now: () => Date.now(), rng: Math.random });

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
  async init(code: string, inviteId: string): Promise<boolean> {
    if (this.room) return false;
    this.room = new Room(createRoomState(code, Date.now(), inviteId), {}, { now: () => Date.now(), rng: Math.random });
    await this.saveState();
    return true;
  }

  /** Deletes the room: closes sockets and wipes storage, after which Cloudflare drops the object. */
  async destroy(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      this.sendTo(ws, { t: "closed", code: CLOSE.deleted, message: "This room was deleted." });
      try {
        ws.close(CLOSE.deleted, "room deleted");
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
        this.sendTo(server, { t: "error", message: `Room ${code} doesn't exist. Check the code?` });
        server.close(CLOSE.notFound, "no such room");
        return new Response(null, { status: 101, webSocket: client });
      }

      try {
        const joined = this.room.join({
          playerId: url.searchParams.get("pid") ?? undefined,
          secret: url.searchParams.get("secret") ?? undefined,
          name: url.searchParams.get("name") ?? undefined,
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

    const result = room.handle(att.playerId, parsed.data);
    for (const out of result.outbound) {
      if (out.to === "self") this.sendTo(ws, out.msg);
      else this.sendToOthers(att.playerId, out.msg);
    }
    if (result.changed) {
      await this.saveState();
      this.broadcastState();
      await this.scheduleAlarm();
      await this.pushSummary(true);
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
    for (const ws of this.liveSockets()) {
      const att = ws.deserializeAttachment() as Attachment;
      const heard = Math.max(this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0, att.since ?? 0);
      if (now - heard < HEARTBEAT_STALE_MS) continue;
      ws.serializeAttachment({ ...att, stale: true } satisfies Attachment);
      try {
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
    await this.sweepStaleSockets();
    const progressed = this.room.tick();
    if (progressed) {
      await this.saveState();
      this.broadcastState();
      await this.pushSummary(false);
    }
    await this.scheduleAlarm(progressed);
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
   */
  private async scheduleAlarm(progressed = true) {
    const current = await this.ctx.storage.getAlarm();
    let next = this.room?.nextAlarm() ?? null;
    const now = Date.now();
    if (next !== null) {
      if (!progressed && next <= now) {
        console.warn(`Room ${this.room?.state.code}: pick deadline overdue but nothing advanced; backing off.`);
        next = now + STUCK_ALARM_BACKOFF_MS;
      } else {
        next = Math.max(next, now + 50);
      }
    }
    // While anyone is connected, wake up now and then to catch silently dropped sockets. An alarm
    // already due soon enough is kept, so frequent reschedules don't keep pushing the sweep back.
    if (this.liveSockets().length > 0) {
      const sweep = current !== null && current > now && current <= now + PRESENCE_SWEEP_MS ? current : now + PRESENCE_SWEEP_MS;
      next = next === null ? sweep : Math.min(next, sweep);
    }
    if (next === current) return;
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
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
