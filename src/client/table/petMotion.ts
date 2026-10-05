// How a table companion moves. The three.js bits live in TableScene; the timing is here so it can be tested.

/** How long a companion hops after its player's turn starts: full height, then easing off to rest. */
export const HOP_SECONDS = 5;
export const HOP_EASE_SECONDS = 1.5;

/**
 * How much of the full hop height to use, `sinceTurnStart` seconds into the player's turn:
 * 1 at first, easing down to 0 by HOP_SECONDS. `null` (not their turn) means no hopping.
 */
export function hopFade(sinceTurnStart: number | null): number {
  if (sinceTurnStart === null) return 0;
  return Math.min(1, Math.max(0, (HOP_SECONDS - sinceTurnStart) / HOP_EASE_SECONDS));
}
