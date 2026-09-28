// Public rooms: online rooms anyone can host without an invite code, from a small shared pool.
// Pure logic: the public pool Durable Object owns persistence, tests drive this directly.
//
// The pool limits how many public rooms exist at once, not how many are created per day: a slot
// frees up as soon as its room closes, so rooms nobody uses don't lock others out for hours.
// Each room closes for good PUBLIC_LIMITS.ttlMs after it was created, or once nobody has been
// connected for PUBLIC_LIMITS.idleMs (the room enforces both with its own alarm).

export const PUBLIC_LIMITS = {
  /** Public rooms that may exist at once. */
  slots: 3,
  /** A public room closes this long after it was created, whatever is going on in it. */
  ttlMs: 6 * 60 * 60 * 1000,
  /** A public room closes once no human has been connected for this long. */
  idleMs: 15 * 60 * 1000,
  /** A full pool asks its rooms whether they're still alive at most this often. */
  aliveCheckMs: 60 * 1000,
};

export interface PublicSlot {
  code: string;
  createdAt: number;
  expiresAt: number;
  /** Hashed visitor key (see visitorPrefix) of whoever created it: one public room per visitor. */
  visitor: string;
}

export interface PublicPool {
  slots: PublicSlot[];
  /** When the pool last asked its rooms whether they're still alive (see PUBLIC_LIMITS.aliveCheckMs). */
  checkedAt: number;
}

/** What GET /api/public returns. */
export interface PublicStatus {
  /** Public hosting is switched on (PUBLIC_ROOMS_ENABLED). The other fields are only set when it is. */
  enabled: boolean;
  slots?: number;
  used?: number;
  /** When the next slot frees up at the latest, if the pool is full (an idle room can free one sooner). */
  nextFreeAt?: number | null;
  /** This visitor's open public room, if any. */
  yours?: { code: string; expiresAt: number } | null;
  ttlMs?: number;
  idleMs?: number;
  /** Cloudflare Turnstile site key, when Turnstile is configured. */
  turnstileSiteKey?: string | null;
}

export function emptyPool(): PublicPool {
  return { slots: [], checkedAt: 0 };
}

/** "6 hours", "15 minutes": how the limits read in player-facing text. */
export function durationLabel(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours >= 1 && Number.isInteger(hours)) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const minutes = Math.round(ms / 60_000);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** Drops slots whose room has passed its hard expiry. */
export function prunePool(pool: PublicPool, now: number): void {
  pool.slots = pool.slots.filter((s) => s.expiresAt > now);
}

export function poolStatus(pool: PublicPool, visitor: string, now: number): Omit<PublicStatus, "enabled" | "turnstileSiteKey"> {
  const live = pool.slots.filter((s) => s.expiresAt > now);
  const mine = live.find((s) => s.visitor === visitor);
  return {
    slots: PUBLIC_LIMITS.slots,
    used: live.length,
    nextFreeAt: live.length >= PUBLIC_LIMITS.slots ? Math.min(...live.map((s) => s.expiresAt)) : null,
    yours: mine ? { code: mine.code, expiresAt: mine.expiresAt } : null,
    ttlMs: PUBLIC_LIMITS.ttlMs,
    idleMs: PUBLIC_LIMITS.idleMs,
  };
}

export type PublicBlocker = { status: number; error: string; code?: string };

/** Null when this visitor may create a public room now, else why not. */
export function publicBlocker(pool: PublicPool, visitor: string, now: number): PublicBlocker | null {
  const s = poolStatus(pool, visitor, now);
  if (s.yours) return { status: 409, error: "You already have a public room open. Head back to it, or wait for it to close.", code: s.yours.code };
  if (s.nextFreeAt != null) {
    return { status: 429, error: `All ${PUBLIC_LIMITS.slots} public tables are in use. One frees up ${fromNow(s.nextFreeAt, now)} at the latest, sooner if a table goes idle.` };
  }
  return null;
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
  const [head, tail = ""] = raw.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  // An embedded IPv4 tail (::ffff:1.2.3.4) is two groups; only the first four groups matter here.
  const missing = Math.max(0, 8 - left.length - right.length);
  const groups = raw.includes("::") ? [...left, ...Array(missing).fill("0"), ...right] : left;
  return groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, "") || "0")
    .join(":");
}
