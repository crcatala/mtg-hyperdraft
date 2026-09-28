// Flood control for room Durable Objects: token buckets per socket and per room, closing sockets
// that keep flooding, and a short rejoin penalty for their players. Pure logic (time is passed in),
// tests drive it directly. It lives in memory only: a room that hibernates was idle, so its
// buckets would have refilled anyway.
//
// Why it matters: every message wakes the room (duration) and counts as a request (1 per 20
// WebSocket messages), and every state change is a storage write. On the free plan, going over any
// daily limit breaks every room on the account until the next day.

export interface BucketSpec {
  /** Most tokens a bucket holds: how big a burst it allows. */
  capacity: number;
  /** Tokens added per second: the sustained rate it allows. */
  perSecond: number;
}

export const RATE_LIMITS = {
  /**
   * Every message from one socket, short term. Drag previews alone are up to 20/s (see
   * table/drag.ts), so this only bites on floods.
   */
  socket: { capacity: 60, perSecond: 30 } satisfies BucketSpec,
  /**
   * Every message from one socket, long term: minutes of nonstop dragging, but no socket can keep
   * sending more than 5 messages a second.
   */
  socketSustained: { capacity: 3000, perSecond: 5 } satisfies BucketSpec,
  /**
   * Every message, across the whole room: minutes of four people dragging at once, but a flood
   * can't keep a room busy at more than 10 messages a second.
   */
  roomMessages: { capacity: 6000, perSecond: 10 } satisfies BucketSpec,
  /**
   * Messages that may change room state, across the whole room. Each one is a storage write, and
   * writes are the scarcest free-plan resource (100k/day for the whole account). A lively 4-player
   * table stays far below 1/s on average; the burst absorbs flurries like untapping and drawing.
   */
  roomWrites: { capacity: 120, perSecond: 1 } satisfies BucketSpec,
  /**
   * A socket with this many messages dropped over its own limits (not the room's, which another
   * player may have used up) within floodWindowMs is closed: dropping alone still lets it wake the
   * room and use up requests. People never get near it.
   */
  floodDrops: 100,
  floodWindowMs: 10_000,
  /** A player whose socket was closed for flooding can't rejoin for this long. */
  penaltyMs: 60_000,
  /** A throttled socket hears "slow down" at most this often. */
  noticeMs: 5000,
};

export type FloodVerdict = "ok" | "drop" | "close";

interface SocketState {
  burst: TokenBucket;
  sustained: TokenBucket;
  drops: number;
  windowStart: number;
  noticeAt: number;
}

export class FloodControl {
  private sockets = new Map<string, SocketState>();
  private messages: TokenBucket;
  private writes: TokenBucket;
  private penalties = new Map<string, number>();

  constructor(now: number) {
    this.messages = new TokenBucket(RATE_LIMITS.roomMessages, now);
    this.writes = new TokenBucket(RATE_LIMITS.roomWrites, now);
  }

  /**
   * Judges one incoming message from socket `sid` (player `playerId`); `writes` is whether it may
   * change room state. "drop": ignore it (`notice`: tell the sender to slow down). "close": close
   * the socket; the player is barred from rejoining for RATE_LIMITS.penaltyMs.
   */
  check(sid: string, playerId: string, writes: boolean, now: number): { verdict: FloodVerdict; notice: boolean } {
    let s = this.sockets.get(sid);
    if (!s) {
      s = { burst: new TokenBucket(RATE_LIMITS.socket, now), sustained: new TokenBucket(RATE_LIMITS.socketSustained, now), drops: 0, windowStart: now, noticeAt: -Infinity };
      this.sockets.set(sid, s);
    }
    const own = s.burst.take(now) && s.sustained.take(now);
    if (own && this.messages.take(now) && (!writes || this.writes.take(now))) return { verdict: "ok", notice: false };

    if (!own) {
      if (now - s.windowStart > RATE_LIMITS.floodWindowMs) {
        s.windowStart = now;
        s.drops = 0;
      }
      if (++s.drops >= RATE_LIMITS.floodDrops) {
        this.sockets.delete(sid);
        this.penalties.set(playerId, now + RATE_LIMITS.penaltyMs);
        return { verdict: "close", notice: false };
      }
    }
    const notice = now - s.noticeAt >= RATE_LIMITS.noticeMs;
    if (notice) s.noticeAt = now;
    return { verdict: "drop", notice };
  }

  /** Whether this player was recently closed for flooding (and may not rejoin yet). */
  penalized(playerId: string, now: number): boolean {
    const until = this.penalties.get(playerId);
    if (until === undefined) return false;
    if (until > now) return true;
    this.penalties.delete(playerId);
    return false;
  }

  /** Forgets a socket that has gone. */
  forget(sid: string) {
    this.sockets.delete(sid);
  }
}

export class TokenBucket {
  private tokens: number;
  private at: number;

  constructor(
    private spec: BucketSpec,
    now: number,
  ) {
    this.tokens = spec.capacity;
    this.at = now;
  }

  /** Takes one token. Returns false (and takes nothing) when the bucket is empty. */
  take(now: number): boolean {
    this.tokens = Math.min(this.spec.capacity, this.tokens + (Math.max(0, now - this.at) / 1000) * this.spec.perSecond);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
