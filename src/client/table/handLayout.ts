// Geometry of the hand fan. Pure so it can be unit tested: however many cards you hold, the fan
// must fit the space it's given and keep every card's visible strip wide enough to hover.

export const HAND_CARD_W = 150;
const MIN_W_LARGE_HAND = 92;
const MIN_W_HUGE_HAND = 70;
/** Narrowest visible strip per card before cards start shrinking below MIN_W_LARGE_HAND. */
const MIN_STRIP = 16;
/** Edge cards tilt at most this much, however big the hand. */
export const MAX_EDGE_ROT_DEG = 12;
/** Edge cards sink at most this far below the middle ones. */
export const MAX_ARC_PX = 26;

export interface HandLayout {
  /** Card width in px. */
  width: number;
  /** Horizontal distance between neighbouring cards in px. */
  spread: number;
  /** Total fan width in px. */
  fanWidth: number;
  /** Rotation (deg) and vertical drop (px) of the i-th card. */
  rot: (i: number) => number;
  arc: (i: number) => number;
}

export function handLayout(n: number, available: number): HandLayout {
  const avail = Math.max(0, available);
  let width = n > 9 ? Math.max(MIN_W_LARGE_HAND, HAND_CARD_W - (n - 9) * 6) : HAND_CARD_W;
  const spreadFor = (w: number) => (n > 1 ? Math.max(0, Math.min(w * 0.72, (avail - w) / (n - 1))) : 0);
  let spread = spreadFor(width);
  // Huge hands in narrow windows: shrink the cards rather than letting strips get unhoverable.
  if (n > 1 && spread < MIN_STRIP) {
    width = Math.max(MIN_W_HUGE_HAND, Math.min(width, avail - MIN_STRIP * (n - 1)));
    spread = spreadFor(width);
  }
  const half = (n - 1) / 2;
  const rotStep = n > 1 ? Math.min(2.2, (MAX_EDGE_ROT_DEG * 2) / (n - 1)) : 0;
  const maxArc = Math.min(1.8 * half ** 1.7, MAX_ARC_PX);
  return {
    width,
    spread,
    fanWidth: n > 0 ? spread * (n - 1) + width : 0,
    rot: (i) => (i - half) * rotStep,
    arc: (i) => (half > 0 ? Math.abs((i - half) / half) ** 1.7 * maxArc : 0),
  };
}
