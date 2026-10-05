// Which reaction each companion is playing: `playReaction(playerId, slot)` from anywhere (pokes, emotes,
// pick-up, the lab), read every frame by that player's CompanionFigure. Keyed by player rather than companion
// so two copies of one companion at a table react separately, and it works for anyone's companion, not just
// the viewer's. A plain map, not a store: the figures poll it in useFrame, so nothing needs to re-render.

import { REACTION_IDS } from "../../shared/companionKit";

export interface PlayingReaction {
  slot: string;
  /** reactionNow() when it started. */
  at: number;
  /** Bumped by every play/stop, so a figure can tell a restart of the same slot from the one it is showing. */
  seq: number;
}

const playing = new Map<string, PlayingReaction>();
let seq = 0;

// The reactions' clock: performance.now(), except that the lab can slow it down to look closely. It never
// jumps, so changing the speed mid-reaction doesn't pop.
let scale = 1;
let base = 0;
let since = 0;
export function reactionNow(): number {
  const real = performance.now();
  if (!since) since = real;
  base += (real - since) * scale;
  since = real;
  return base;
}
/** Slow-motion for the lab (1 = real time). */
export function setReactionTimeScale(k: number) {
  reactionNow();
  scale = Math.max(0, k);
}

/** Starts a reaction on a player's companion, cutting off (and blending out of) whatever it was doing. Unknown slots are ignored. */
export function playReaction(playerId: string, slot: string) {
  if (!REACTION_IDS.includes(slot)) return;
  playing.set(playerId, { slot, at: reactionNow(), seq: ++seq });
}

/** Ends a player's companion's reaction (the carry loop, say): it blends back to standing. */
export function stopReaction(playerId: string) {
  if (!playing.has(playerId)) return;
  playing.set(playerId, { slot: "", at: reactionNow(), seq: ++seq });
}

/** What a player's companion is playing (slot "" once stopped), or null if it never reacted. */
export const reactionOf = (playerId: string): PlayingReaction | null => playing.get(playerId) ?? null;

/** Forgets every companion's reaction (leaving the table: the next room reuses player ids). */
export function clearReactions() {
  playing.clear();
}
