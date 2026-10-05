// The poke ladder (the old "click the unit too many times" gag): each tap on a companion climbs one step,
// curious → happy → … → the cheeky finale, then it sulks and won't play for a while, then it starts over.
// Every viewer keeps their own ladders (the server keeps none); someone else's poke moves yours too, so a
// companion poked by two players at once escalates once, not twice in parallel. Pure, so it can be tested.

import { POKE_STEPS } from "../../shared/companionKit";

/** A companion left alone this long starts over at the first step. */
export const IDLE_RESET_MS = 5000;
/** After the finale, taps on that companion are ignored for this long, then the ladder starts over. */
export const SULK_MS = 4000;
/** Taps closer together than this (on any companion) are ignored. */
export const POKE_THROTTLE_MS = 300;

const FINALE = POKE_STEPS - 1;

interface Rung {
  /** The last step shown (0-based). */
  step: number;
  at: number;
  /** While sulking after the finale: when it's over (0 = not sulking). */
  sulkUntil: number;
}

export interface Ladder {
  rungs: Map<string, Rung>;
  /** When this viewer's last tap was accepted (on any companion). */
  lastTap: number;
}

export const newLadder = (): Ladder => ({ rungs: new Map(), lastTap: -Infinity });

/** Where a companion's ladder stands after a step shown at `now`. */
const rung = (step: number, now: number): Rung => ({ step, at: now, sulkUntil: step === FINALE ? now + SULK_MS : 0 });

/** The step a tap would show on `target` at `now`, without taking it; null while it sulks. */
export function nextStep(ladder: Ladder, target: string, now: number): number | null {
  const r = ladder.rungs.get(target);
  if (!r) return 0;
  if (r.sulkUntil) return now < r.sulkUntil ? null : 0;
  return now - r.at > IDLE_RESET_MS ? 0 : Math.min(FINALE, r.step + 1);
}

/** This viewer taps `target`: the step to show (0-based), or null when the tap is ignored (sulking, or too soon). */
export function tapLadder(ladder: Ladder, target: string, now: number): number | null {
  if (now - ladder.lastTap < POKE_THROTTLE_MS) return null;
  const step = nextStep(ladder, target, now);
  if (step === null) return null;
  ladder.lastTap = now;
  ladder.rungs.set(target, rung(step, now));
  return step;
}

/** Someone else poked `target` at `step`: this viewer's ladder for it moves there too. */
export function observePoke(ladder: Ladder, target: string, step: number, now: number) {
  ladder.rungs.set(target, rung(Math.max(0, Math.min(FINALE, step)), now));
}
