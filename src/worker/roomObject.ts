// One Durable Object per room. Thin shell around the pure `Room` engine:
// websockets (hibernation API), persistence to DO storage, alarms for pick timers, and cube imports.

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";
import { clientMessageSchema, type ServerMessage } from "../shared/protocol";
import { createRoomState, Room, RoomError, type ImportResult } from "../shared/room";
import type { BasicLand, CardData, CardMap, RoomState } from "../shared/types";
import { BASIC_NAMES } from "../shared/types";
import { parseImport, type ImportEntry } from "../shared/importParser";
import { fetchCubeCobra, resolveEntries } from "../shared/cardSources";

interface Attachment {
  playerId: string;
}

const CARD_CHUNK = 150; // Cards per storage key (values must stay well under 2 MB).

export class RoomDurableObject extends DurableObject<Env> {
  private room: Room | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // With hibernation the constructor runs on every wake-up, so keep this to one storage read.
    ctx.blockConcurrencyWhile(async () => {
      const state = await ctx.storage.get<RoomState>("state");
      if (!state) return;
      const chunks = (await ctx.storage.get<number>("cardChunks")) ?? 0;
      const cards: CardMap = {};
      if (chunks > 0) {
        const stored = await ctx.storage.get<CardData[]>(Array.from({ length: chunks }, (_, i) => `cards:${i}`));
        for (const list of stored.values()) for (const c of list) cards[c.id] = c;
      }
      this.room = new Room(state, cards, { now: () => Date.now(), rng: Math.random });
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const [code, action] = url.pathname.split("/").filter(Boolean);

    if (action === "init" && request.method === "POST") {
      if (this.room) return new Response("exists", { status: 409 });
      this.room = new Room(createRoomState(code, Date.now()), {}, { now: () => Date.now(), rng: Math.random });
      await this.saveState();
      return new Response("created", { status: 201 });
    }

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
        server.close(4404, "no such room");
        return new Response(null, { status: 101, webSocket: client });
      }

      try {
        const joined = this.room.join({
          playerId: url.searchParams.get("pid") ?? undefined,
          secret: url.searchParams.get("secret") ?? undefined,
          name: url.searchParams.get("name") ?? undefined,
        });
        server.serializeAttachment({ playerId: joined.playerId } satisfies Attachment);
        this.sendTo(server, { t: "welcome", you: joined.playerId, secret: joined.secret, code: this.room.state.code });
        this.sendTo(server, { t: "cards", cards: this.room.cards });
        await this.saveState();
        this.broadcastState();
      } catch (err) {
        const message = err instanceof RoomError ? err.message : "Could not join the room.";
        this.sendTo(server, { t: "error", message });
        server.close(4403, "join refused");
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
    const stillConnected = this.ctx.getWebSockets().some((s) => s !== ws && (s.deserializeAttachment() as Attachment | null)?.playerId === att.playerId);
    if (!stillConnected && this.room.setConnected(att.playerId, false)) {
      await this.saveState();
      this.broadcastState();
    }
  }

  async alarm(): Promise<void> {
    if (!this.room) return;
    if (this.room.tick()) {
      await this.saveState();
      this.broadcastState();
    }
    await this.scheduleAlarm();
  }

  // --- imports --------------------------------------------------------------------------------

  private async runImport(source: string) {
    const room = this.room!;
    const progress = async (message: string) => {
      room.setImportProgress(message);
      this.broadcastState();
    };
    try {
      const parsed = parseImport(source);
      let name: string;
      let entries: ImportEntry[];
      let warnings: string[] = [];
      if (parsed.kind === "cubecobra") {
        await progress("Fetching cube from CubeCobra…");
        const cube = await fetchCubeCobra(parsed.id, fetch);
        name = cube.name;
        entries = cube.entries;
      } else {
        name = "Custom list";
        entries = parsed.entries;
        warnings = parsed.warnings;
      }
      if (entries.length === 0) throw new Error("No cards found in that list.");

      const res = await resolveEntries(entries, fetch, { onProgress: (m) => void progress(m) });
      const basicEntries = (Object.keys(BASIC_NAMES) as BasicLand[]).map((b) => ({ name: BASIC_NAMES[b], count: 1 }));
      const basics = await resolveEntries(basicEntries, fetch, { delayMs: 100 });
      const basicIds: ImportResult["basics"] = {};
      for (const card of basics.cards) {
        const key = (Object.keys(BASIC_NAMES) as BasicLand[]).find((b) => BASIC_NAMES[b] === card.name);
        if (key) basicIds[key] = card.id;
      }

      if (res.pool.length === 0) throw new Error("None of those cards were found on Scryfall.");
      for (const k of Object.keys(room.cards)) delete room.cards[k];
      room.applyImport({
        name: parsed.kind === "list" ? `${name} (${res.pool.length} cards)` : name,
        source: parsed.kind === "cubecobra" ? `cubecobra:${parsed.id}` : "pasted list",
        cards: [...res.cards, ...basics.cards],
        pool: res.pool,
        notFound: res.notFound,
        warnings: [...warnings, ...res.warnings],
        basics: basicIds,
      });
      await this.saveCards();
    } catch (err) {
      room.failImport(err instanceof Error ? err.message : "Import failed.");
    }
    await this.saveState();
    this.broadcast({ t: "cards", cards: room.cards });
    this.broadcastState();
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

  private async scheduleAlarm() {
    const at = this.room?.nextAlarm() ?? null;
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(at, Date.now() + 50));
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
