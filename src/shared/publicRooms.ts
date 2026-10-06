// Public rooms: online rooms anyone can host without an invite code, from a small shared pool.
// Pure logic: the public pool Durable Object owns persistence, tests drive this directly.
//
// The pool limits how many public rooms exist at once, not how many are created per day: a slot
// frees up as soon as its room closes, so rooms nobody uses don't lock others out for hours.
// Each room closes for good at its expiresAt, or once nobody has been connected for
// PUBLIC_LIMITS.idleMs (the room enforces both with its own alarm).
//
// A daily budget of room time caps the worst case: each new room reserves its whole lifetime
// (3 hours, or whatever is left of today's budget) up front, and gets back what it didn't use when
// it closes early. However rooms are used, rooms opened on one UTC day never run for more than the
// budget in total. A room opened late keeps running past midnight while the next day's budget starts
// fresh, so one UTC day can see up to the budget plus slots × ttlMs (about 21 room-hours), which still
// keeps public rooms inside the free plan's daily Durable Object limits.

export const PUBLIC_LIMITS = {
  /** Public rooms that may exist at once. */
  slots: 3,
  /** The longest a public room stays open, whatever is going on in it. */
  ttlMs: 3 * 60 * 60 * 1000,
  /** A public room closes once no human has been connected for this long. */
  idleMs: 15 * 60 * 1000,
  /** Room time all public rooms together may use per UTC day. */
  dailyBudgetMs: 12 * 60 * 60 * 1000,
  /** Public rooms one visitor may create per UTC day. */
  perVisitorPerDay: 2,
  /** A room shorter than this isn't worth starting: the budget counts as spent for the day. */
  minRoomMs: 30 * 60 * 1000,
  /** A room blocking a create (full pool, or the visitor's own room) is asked whether it's still open at most this often. */
  aliveCheckMs: 60 * 1000,
};

/** The Turnstile widget's `action`: the Worker refuses tokens made for anything else. */
export const TURNSTILE_ACTION = "host-public-room";

export interface PublicSlot {
  code: string;
  createdAt: number;
  expiresAt: number;
  /** Hashed visitor key (see visitorPrefix) of whoever created it: one public room per visitor. */
  visitor: string;
  /** UTC day (YYYY-MM-DD) whose budget paid for this room. */
  day: string;
  /** When the pool last asked this room whether it's still alive. */
  checkedAt?: number;
}

export interface PublicPool {
  slots: PublicSlot[];
  /** The UTC day the budget fields below are for. */
  day: string;
  /** Room time reserved today (see the budget note at the top). */
  usedMs: number;
  /** Public rooms each visitor created today. */
  hosted: Record<string, number>;
}

/** What GET /api/public returns: the same for every visitor, so it can be cached. */
export interface PublicStatus {
  /** Public hosting is switched on (PUBLIC_ROOMS_ENABLED). The other fields are only set when it is. */
  enabled: boolean;
  slots?: number;
  used?: number;
  /** When the next slot frees up at the latest, if the pool is full (an idle room can free one sooner). */
  nextFreeAt?: number | null;
  /** How long a room created now would last (less than ttlMs when today's budget is running low). */
  nextRoomMs?: number;
  /** Set when today's budget is spent: when public rooms open again (UTC midnight). */
  reopensAt?: number | null;
  idleMs?: number;
  /** Cloudflare Turnstile site key, when Turnstile is configured. */
  turnstileSiteKey?: string | null;
}

export function emptyPool(): PublicPool {
  return { slots: [], day: "", usedMs: 0, hosted: {} };
}

/** "6 hours", "15 minutes": how the limits read in player-facing text. */
export function durationLabel(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours >= 1 && Number.isInteger(hours)) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const minutes = Math.round(ms / 60_000);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** Starts a fresh budget when the UTC day has changed. Also fills in fields older pools lack. */
export function rollDay(pool: PublicPool, now: number): void {
  const day = utcDay(now);
  if (pool.day === day) return;
  pool.day = day;
  pool.usedMs = 0;
  pool.hosted = {};
}

/** Drops slots whose room has passed its expiry (their reserved time was used up, no refund). */
export function prunePool(pool: PublicPool, now: number): void {
  pool.slots = pool.slots.filter((s) => s.expiresAt > now);
}

/** How long a room created now would last: 0 when today's budget is spent. */
export function nextRoomMs(pool: PublicPool, now: number): number {
  rollDay(pool, now);
  const ms = Math.min(PUBLIC_LIMITS.ttlMs, PUBLIC_LIMITS.dailyBudgetMs - pool.usedMs);
  return ms >= PUBLIC_LIMITS.minRoomMs ? ms : 0;
}

export function poolStatus(pool: PublicPool, now: number): Omit<PublicStatus, "enabled" | "turnstileSiteKey"> {
  const live = pool.slots.filter((s) => s.expiresAt > now);
  const next = nextRoomMs(pool, now);
  return {
    slots: PUBLIC_LIMITS.slots,
    used: live.length,
    nextFreeAt: live.length >= PUBLIC_LIMITS.slots ? Math.min(...live.map((s) => s.expiresAt)) : null,
    nextRoomMs: next,
    reopensAt: next === 0 ? nextUtcMidnight(now) : null,
    idleMs: PUBLIC_LIMITS.idleMs,
  };
}

/** The visitor's open public room, if any. */
export function visitorSlot(pool: PublicPool, visitor: string, now: number): PublicSlot | null {
  return pool.slots.find((s) => s.visitor === visitor && s.expiresAt > now) ?? null;
}

export type PublicBlocker = { status: number; error: string; code?: string; expiresAt?: number };

/** Null when this visitor may create a public room now, else why not. */
export function publicBlocker(pool: PublicPool, visitor: string, now: number): PublicBlocker | null {
  const mine = visitorSlot(pool, visitor, now);
  if (mine) return { status: 409, error: "You already have a public room open. Head back to it, or wait for it to close.", code: mine.code, expiresAt: mine.expiresAt };
  const s = poolStatus(pool, now);
  if (s.reopensAt) {
    return { status: 429, error: `Today's public table time is all booked. Rooms that close early give some back; at the latest it resets ${fromNow(s.reopensAt, now)}.` };
  }
  if ((pool.hosted[visitor] ?? 0) >= PUBLIC_LIMITS.perVisitorPerDay) {
    return { status: 429, error: `You've hosted ${PUBLIC_LIMITS.perVisitorPerDay} public rooms today, the daily limit. Solo mode is always open.` };
  }
  if (s.nextFreeAt != null) {
    return { status: 429, error: `All ${PUBLIC_LIMITS.slots} public tables are in use. One frees up ${fromNow(s.nextFreeAt, now)} at the latest, sooner if a table goes idle.` };
  }
  return null;
}

/**
 * Takes a slot for a new room (call publicBlocker first): reserves its whole lifetime from today's
 * budget and counts it against the visitor. The code is filled in once the room exists.
 */
export function reserveSlot(pool: PublicPool, visitor: string, now: number): PublicSlot {
  const lifetime = nextRoomMs(pool, now);
  const slot: PublicSlot = { code: "", createdAt: now, expiresAt: now + lifetime, visitor, day: pool.day };
  pool.slots.push(slot);
  pool.usedMs += lifetime;
  pool.hosted[visitor] = (pool.hosted[visitor] ?? 0) + 1;
  return slot;
}

/** Undoes reserveSlot when the room couldn't be created. */
export function unreserveSlot(pool: PublicPool, slot: PublicSlot): void {
  pool.slots = pool.slots.filter((s) => s !== slot);
  if (slot.day !== pool.day) return;
  pool.usedMs = Math.max(0, pool.usedMs - (slot.expiresAt - slot.createdAt));
  pool.hosted[slot.visitor] = Math.max(0, (pool.hosted[slot.visitor] ?? 1) - 1);
}

/**
 * Frees the slots of rooms that have closed, by code (never by position: callers may have awaited
 * in between, and the slot list may have changed). Time a room didn't use goes back to today's
 * budget. Returns true if anything changed.
 */
export function releaseSlots(pool: PublicPool, codes: ReadonlySet<string>, now: number): boolean {
  rollDay(pool, now);
  const closing = pool.slots.filter((s) => s.code && codes.has(s.code));
  if (closing.length === 0) return false;
  for (const s of closing) if (s.day === pool.day) pool.usedMs = Math.max(0, pool.usedMs - Math.max(0, s.expiresAt - now));
  pool.slots = pool.slots.filter((s) => !closing.includes(s));
  return true;
}

/** "in 12 min" / "in about 3h". Server text has no idea of the player's time zone, so no clock times. */
function fromNow(at: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((at - now) / 60_000));
  return minutes < 60 ? `in ${minutes} min` : `in about ${Math.round(minutes / 60)}h`;
}

/**
 * The part of a visitor's IP that identifies them for the one-room-per-visitor rule. IPv4: the
 * whole address. IPv6: the /64 prefix, since one connection usually gets a whole /64 and could
 * otherwise rotate through addresses at will.
 */
export function visitorPrefix(ip: string | null | undefined): string {
  const raw = (ip ?? "").trim().toLowerCase();
  if (!raw) return "unknown";
  if (!raw.includes(":")) return raw;
  // An IPv4 address written as IPv6 (::ffff:1.2.3.4) is that IPv4 visitor.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(raw);
  if (mapped) return mapped[1];
  const [head, tail = ""] = raw.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  // Only the first four groups (the /64) matter here.
  const missing = Math.max(0, 8 - left.length - right.length);
  const groups = raw.includes("::") ? [...left, ...Array(missing).fill("0"), ...right] : left;
  return groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, "") || "0")
    .join(":");
}
