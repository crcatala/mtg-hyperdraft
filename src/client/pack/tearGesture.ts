// How dragging across a pack tears it, as pure functions (the scene turns them into motion).
//
// The tear front follows the pointer along the top of the pack but only ever moves forward, and only
// as fast as foil can plausibly rip, so a fast flick still reads as a rip rather than a teleport.
// Let go halfway and the tear stays where it is (you can pick it up again); let go past
// FINISH_AT and it tears the rest of the way by itself.

import { HALF_W, PACK_W, clamp01 } from "./packShape";

/** +1 tears left → right, -1 right → left. */
export type TearDir = 1 | -1;

/** Progress 0…1 of a tear in direction `dir` that has reached pack-local x. */
export function progressAt(localX: number, dir: TearDir): number {
  return clamp01((dir * localX + HALF_W) / PACK_W);
}

/**
 * Which way a grab at pack-local x tears: away from the nearer side edge. Near the middle it's
 * undecided (0) and the first bit of drag decides.
 */
export function dirFromGrab(localX: number): TearDir | 0 {
  if (Math.abs(localX) < 0.3) return 0;
  return localX < 0 ? 1 : -1;
}

/** The fastest a tear front moves, in pack widths per second. */
export const MAX_RATE = 3.4;
/** The tear counts as done (the strip comes away) at this progress. */
export const COMMIT_AT = 0.985;
/** Releasing a drag past this progress finishes the tear by itself. */
export const FINISH_AT = 0.55;

/** One frame of the front chasing the pointer's target: never backwards, never faster than MAX_RATE. */
export function stepFront(p: number, target: number, dt: number): number {
  const gap = target - p;
  if (gap <= 0) return p;
  if (gap < 0.0015) return target;
  return p + Math.min(gap, Math.max(gap * 14 * dt, 0.12 * dt), MAX_RATE * dt);
}

/** A tear that runs by itself (click, Space, or a released drag): slow to bite, then it rips. */
export function autoStep(p: number, dt: number): number {
  return Math.min(1, p + (0.7 + 3.4 * p) * dt);
}

/** Tear speed for the rip sound, 0 (still) … 1 (as fast as it gets). */
export function soundSpeed(rate: number): number {
  return clamp01(rate / 2.4);
}
