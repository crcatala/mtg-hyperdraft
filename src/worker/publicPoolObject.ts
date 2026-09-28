// The one Durable Object behind public rooms: a pool of PUBLIC_LIMITS.slots slots shared by every
// visitor without an invite. Being single-threaded makes the limits exact: two visitors can't both
// take the last slot.
//
// Rooms close themselves (hard expiry or idle, with their own alarm) and hand their slot back via
// release(). Slots past their hard expiry count as free no matter what, and when the pool is full a
// create asks the rooms whether they're still alive (at most once a minute), so a missed release
// only delays a free slot, never loses it. There are no alarms here: nothing wakes the pool but a
// visitor.

import { DurableObject } from "cloudflare:workers";
import { roomStub, type Env } from "./env";
import { emptyPool, poolStatus, PUBLIC_LIMITS, prunePool, publicBlocker, type PublicPool, type PublicStatus } from "../shared/publicRooms";
import { signRoomCode } from "../shared/roomCode";

export type PublicCreateResult = { ok: true; code: string; expiresAt: number } | { ok: false; status: number; error: string; code?: string };

export class PublicPoolDurableObject extends DurableObject<Env> {
  private pool: PublicPool | null = null;

  private async load(): Promise<PublicPool> {
    if (!this.pool) this.pool = (await this.ctx.storage.get<PublicPool>("pool")) ?? emptyPool();
    return this.pool;
  }

  private async save() {
    if (this.pool) await this.ctx.storage.put("pool", this.pool);
  }

  async status(visitor: string): Promise<Omit<PublicStatus, "enabled" | "turnstileSiteKey">> {
    return poolStatus(await this.load(), visitor, Date.now());
  }

  async create(visitor: string): Promise<PublicCreateResult> {
    const secret = this.env.ROOM_CODE_SECRET;
    if (!secret) return { ok: false, status: 503, error: "The server is missing ROOM_CODE_SECRET." };
    const pool = await this.load();
    let now = Date.now();
    prunePool(pool, now);
    if (pool.slots.length >= PUBLIC_LIMITS.slots && now - pool.checkedAt >= PUBLIC_LIMITS.aliveCheckMs) {
      await this.dropDeadRooms(pool, now);
      now = Date.now();
    }

    const blocker = publicBlocker(pool, visitor, now);
    if (blocker) return { ok: false, ...blocker };

    // Reserve the slot before any await, so concurrent requests see it.
    const slot = { code: "", createdAt: now, expiresAt: now + PUBLIC_LIMITS.ttlMs, visitor };
    pool.slots.push(slot);
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
    // Give the reserved slot back.
    pool.slots = pool.slots.filter((s) => s !== slot);
    return { ok: false, status: 503, error: "Could not create a room, try again." };
  }

  /** Called by a public room as it closes. Unknown codes are ignored. */
  async release(code: string): Promise<void> {
    const pool = await this.load();
    const before = pool.slots.length;
    pool.slots = pool.slots.filter((s) => s.code !== code);
    if (pool.slots.length !== before) await this.save();
  }

  /** Asks each room in the pool whether it's still open; frees the slots of those that aren't. */
  private async dropDeadRooms(pool: PublicPool, now: number) {
    pool.checkedAt = now;
    const alive = await Promise.all(
      pool.slots.map(async (s) => {
        // A slot still being set up (no code yet) belongs to a create in flight.
        if (!s.code) return true;
        try {
          return await roomStub(this.env, s.code).publicAlive();
        } catch (err) {
          console.error(`Could not check public room ${s.code}`, err);
          return true;
        }
      }),
    );
    pool.slots = pool.slots.filter((_, i) => alive[i]);
    await this.save();
  }
}
