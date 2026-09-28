// Token buckets for flood control in room Durable Objects. Pure logic (time is passed in), tests
// drive it directly. Buckets live in memory only: a room that hibernates was idle, so its buckets
// would have refilled anyway.

export interface BucketSpec {
  /** Most tokens a bucket holds: how big a burst it allows. */
  capacity: number;
  /** Tokens added per second: the sustained rate it allows. */
  perSecond: number;
}

export const RATE_LIMITS = {
  /**
   * Every message from one socket. Drag previews alone are up to 20/s (see table/drag.ts), so this
   * only bites on floods.
   */
  socket: { capacity: 60, perSecond: 30 } satisfies BucketSpec,
  /**
   * Messages that may change room state, across the whole room. Each one is a storage write, and
   * writes are the scarcest free-plan resource (100k/day for the whole account). A lively 4-player
   * table stays far below 1/s on average; the burst absorbs flurries like untapping and drawing.
   */
  roomWrites: { capacity: 120, perSecond: 1 } satisfies BucketSpec,
};

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
