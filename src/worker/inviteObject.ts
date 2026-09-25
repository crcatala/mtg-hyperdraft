// One Durable Object per invite code. Keeps the invite's room ledger: which rooms it created,
// a short summary of each (pushed by the rooms themselves), and the creation quota. Being
// single-threaded makes the quota exact: two tabs creating rooms at once can't both slip past it.
//
// There are no alarms here on purpose. Rooms idle past the expiry window are deleted lazily,
// whenever the ledger is listed or a room is created, so an unused invite never wakes anything.

import { DurableObject } from "cloudflare:workers";
import { roomStub, type Env } from "./env";
import { createBlocker, emptyLedger, expiredRooms, pruneWindow, quotaInfo, type InviteInfo, type InviteLedger, type RoomSummary } from "../shared/invites";
import { signRoomCode } from "../shared/roomCode";

export type CreateResult = { ok: true; code: string } | { ok: false; status: number; error: string };

export class InviteDurableObject extends DurableObject<Env> {
  private ledger: InviteLedger | null = null;

  private async load(label: string): Promise<InviteLedger> {
    if (!this.ledger) this.ledger = (await this.ctx.storage.get<InviteLedger>("ledger")) ?? emptyLedger(label);
    return this.ledger;
  }

  private async save() {
    if (this.ledger) await this.ctx.storage.put("ledger", this.ledger);
  }

  async createRoom(label: string): Promise<CreateResult> {
    const secret = this.env.ROOM_CODE_SECRET;
    if (!secret) return { ok: false, status: 503, error: "The server is missing ROOM_CODE_SECRET." };
    const ledger = await this.load(label);
    const now = Date.now();
    await this.sweep(ledger, now);

    pruneWindow(ledger, now);
    const blocker = createBlocker(ledger, now);
    if (blocker) return { ok: false, status: 429, error: blocker };

    // Reserve the slot before any await, so concurrent requests see it.
    ledger.created.push(now);
    const record = { code: "", createdAt: now, lastActiveAt: now, phase: "lobby" as const, players: [], bots: 0, cubeName: null, cardCount: 0 };
    ledger.rooms.push(record);

    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = await signRoomCode(secret, Math.random);
        // A collision means the code is taken; try another.
        if (await roomStub(this.env, code).init(code, label)) {
          record.code = code;
          await this.save();
          return { ok: true, code };
        }
      }
    } catch (err) {
      console.error("Room creation failed", err);
    }
    // Give the reserved slot back.
    ledger.rooms = ledger.rooms.filter((r) => r !== record);
    const i = ledger.created.indexOf(now);
    if (i >= 0) ledger.created.splice(i, 1);
    return { ok: false, status: 503, error: "Could not create a room, try again." };
  }

  async info(label: string): Promise<InviteInfo> {
    const ledger = await this.load(label);
    const now = Date.now();
    await this.sweep(ledger, now);
    return {
      label: ledger.label,
      rooms: ledger.rooms.filter((r) => r.code).sort((a, b) => b.lastActiveAt - a.lastActiveAt),
      quota: quotaInfo(ledger, now),
    };
  }

  /** Deletes one of this invite's rooms. Returns false if the room isn't in this ledger. */
  async deleteRoom(label: string, code: string): Promise<boolean> {
    const ledger = await this.load(label);
    if (!ledger.rooms.some((r) => r.code === code)) return false;
    await roomStub(this.env, code).destroy();
    ledger.rooms = ledger.rooms.filter((r) => r.code !== code);
    await this.save();
    return true;
  }

  /** Called by a room when its summary changes or it sees activity. Unknown rooms are ignored. */
  async updateRoom(label: string, code: string, summary: RoomSummary, activeAt: number): Promise<void> {
    const ledger = await this.load(label);
    const record = ledger.rooms.find((r) => r.code === code);
    if (!record) return;
    Object.assign(record, summary, { lastActiveAt: Math.max(record.lastActiveAt, activeAt) });
    await this.save();
  }

  private async sweep(ledger: InviteLedger, now: number) {
    const expired = expiredRooms(ledger, now).filter((r) => r.code);
    if (expired.length === 0) return;
    for (const r of expired) {
      try {
        await roomStub(this.env, r.code).destroy();
      } catch (err) {
        console.error(`Failed to delete expired room ${r.code}`, err);
        continue;
      }
      ledger.rooms = ledger.rooms.filter((x) => x.code !== r.code);
      console.log(`Deleted room ${r.code} (idle since ${new Date(r.lastActiveAt).toISOString()})`);
    }
    await this.save();
  }
}
