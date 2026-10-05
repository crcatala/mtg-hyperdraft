// What companions say at the table: speech bubbles and voice sounds. Every bubble and every table voice goes
// through `say` and `voice` here (pokes now, emotes and pick-up later), so a player's "Companion speech" and
// "Companion sounds" settings can switch them off in one place.

import { create } from "zustand";
import { playVoice, type Voice, type VoiceOptions } from "../companionVoice";

/** How long a bubble stays up, pop-in and pop-out included. */
export const BUBBLE_MS = 2200;

export type BubbleSize = "small" | "large";

export interface Bubble {
  /** Bumped per bubble, so a new one replaces (and re-pops) even with the same text. */
  id: number;
  text: string;
  size: BubbleSize;
  /** performance.now() when it appeared. */
  at: number;
}

/** The bubble over each player's companion (one each: a new one replaces the old). */
export const useBubbles = create<{ bubbles: Record<string, Bubble> }>(() => ({ bubbles: {} }));

let bubbleSeq = 1;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Shows `text` in a bubble over a player's companion for BUBBLE_MS, replacing whatever it was saying. */
export function say(playerId: string, text: string | undefined, size: BubbleSize = "small") {
  if (!text) return;
  const bubble: Bubble = { id: bubbleSeq++, text, size, at: performance.now() };
  useBubbles.setState((s) => ({ bubbles: { ...s.bubbles, [playerId]: bubble } }));
  clearTimeout(timers.get(playerId));
  timers.set(
    playerId,
    setTimeout(() => {
      timers.delete(playerId);
      useBubbles.setState((s) => {
        if (s.bubbles[playerId]?.id !== bubble.id) return s;
        const { [playerId]: _gone, ...rest } = s.bubbles;
        return { bubbles: rest };
      });
    }, BUBBLE_MS),
  );
}

/** Takes every bubble down at once (leaving the table: the next room reuses player ids). */
export function clearBubbles() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  useBubbles.setState({ bubbles: {} });
}

/** Plays one of a companion's voice sounds at the table (see companionVoice.ts). */
export function voice(companion: string, slot: string, opts: VoiceOptions = {}): Voice | null {
  return playVoice(companion, slot, opts);
}

/**
 * How a bubble looks `age` ms in: it pops in (overshooting a touch), holds, then shrinks a little as it fades.
 * Reduced motion: no size change, just the fade.
 */
export function bubblePop(age: number, still = false): { scale: number; alpha: number } {
  const t = Math.max(0, age);
  const inT = Math.min(1, t / 160);
  const outT = Math.min(1, Math.max(0, (t - (BUBBLE_MS - 220)) / 220));
  const alpha = Math.min(1, t / 90) * (1 - outT);
  if (still) return { scale: 1, alpha };
  // easeOutBack: 0 → ~1.08 → 1.
  const c = 1.7;
  const back = 1 + (c + 1) * (inT - 1) ** 3 + c * (inT - 1) ** 2;
  return { scale: Math.max(0, back) * (1 - 0.15 * outT), alpha };
}
