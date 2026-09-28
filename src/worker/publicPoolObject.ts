// The one Durable Object behind public rooms: a pool of PUBLIC_LIMITS.slots slots shared by every
// visitor without an invite, and the daily budget of room time. Being single-threaded makes the
// limits exact: two visitors can't both take the last slot.
//
// Rooms close themselves (expiry or idle, with their own alarm) and hand their slot back via
// release(). Slots past their expiry count as free no matter what, and a create that finds the pool
// full (or the visitor's own room still listed) asks those rooms whether they're still alive, at
// most once a minute, so a missed release only delays a free slot, never loses it. There are no
// alarms here: nothing wakes the pool but a visitor or a closing room.

import { DurableObject } from "cloudflare:workers";
import { roomStub, type Env } from "./env";
import {
  emptyPool,
  poolStatus,
  PUBLIC_LIMITS,
  prunePool,
  publicBlocker,
  releaseSlots,
  reserveSlot,
  rollDay,
  unreserveSlot,
  visitorSlot,
  type PublicPool,
  type PublicSlot,
  type PublicStatus,
} from "../shared/publicRooms";
import { signRoomCode } from "../shared/roomCode";

export type PublicCreateResult = { ok: true; code: string; expiresAt: number } | { ok: false; status: number; error: string; code?: string; expiresAt?: number };

export class PublicPoolDurableObject extends DurableObject<Env> {
  private pool: PublicPool | null = null;

  private async load(): Promise<PublicPool> {
    // Spread over emptyPool() so pools saved before the daily budget existed get its fields.
    if (!this.pool) this.pool = { ...emptyPool(), ...(await this.ctx.storage.get<PublicPool>("pool")) };
    return this.pool;
  }

  private async save() {
    if (this.pool) await this.ctx.storage.put("pool", this.pool);
  }

  /** The same for every visitor (the Worker caches it). Never wakes a room. */
  async status(): Promise<Omit<PublicStatus, "enabled" | "turnstileSiteKey">> {
    return poolStatus(await this.load(), Date.now());
  }

  async create(visitor: string): Promise<PublicCreateResult> {
    const secret = this.env.ROOM_CODE_SECRET;
    if (!secret) return { ok: false, status: 503, error: "The server is missing ROOM_CODE_SECRET." };
    const pool = await this.load();
    let now = Date.now();
    rollDay(pool, now);
    prunePool(pool, now);

    // Before refusing, make sure the rooms in the way are really still open: the visitor's own room
    // (maybe it closed and its release was missed), or the whole pool when it's full.
    const mine = visitorSlot(pool, visitor, now);
    const suspects = mine ? [mine] : pool.slots.length >= PUBLIC_LIMITS.slots ? pool.slots.slice() : [];
    if (await this.dropDeadRooms(pool, suspects, now)) now = Date.now();

    const blocker = publicBlocker(pool, visitor, now);
    if (blocker) return { ok: false, ...blocker };

    // Reserve the slot before any await, so concurrent requests see it.
    const slot = reserveSlot(pool, visitor, now);
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = await signRoomCode(secret, Math.random);
        // A collision means the code is taken; try another.
        if (await roomStub(this.env, code).init(code, { expiresAt: slot.expiresAt })) {
          slot.code = code;
          await this.save();
          return { ok: true, code, expiresAt: slot.expiresAt };
        }
      }
    } catch (err) {
      console.error("Public room creation failed", err);
    }
    unreserveSlot(pool, slot);
    return { ok: false, status: 503, error: "Could not create a room, try again." };
  }

  /** Called by a public room as it closes. Unknown codes are ignored. */
  async release(code: string): Promise<void> {
    const pool = await this.load();
    if (releaseSlots(pool, new Set([code]), Date.now())) await this.save();
  }

  /**
   * Asks the given rooms whether they're still open (each at most once per aliveCheckMs) and frees
   * the slots of those that aren't. Returns true if it asked anything.
   */
  private async dropDeadRooms(pool: PublicPool, slots: PublicSlot[], now: number): Promise<boolean> {
    // A slot still being set up (no code yet) belongs to a create in flight.
    const due = slots.filter((s) => s.code && now - (s.checkedAt ?? 0) >= PUBLIC_LIMITS.aliveCheckMs);
    if (due.length === 0) return false;
    for (const s of due) s.checkedAt = now;
    const dead = new Set<string>();
    await Promise.all(
      due.map(async (s) => {
        try {
          if (!(await roomStub(this.env, s.code).publicAlive())) dead.add(s.code);
        } catch (err) {
          console.error(`Could not check public room ${s.code}`, err);
        }
      }),
    );
    // Other calls may have changed the pool while we waited: release by code, not position.
    releaseSlots(pool, dead, Date.now());
    await this.save();
    return true;
  }
}
