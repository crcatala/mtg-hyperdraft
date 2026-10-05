// What companions say at the table: speech bubbles and voice sounds. Every bubble and every table voice goes
// through `say` and `voice` here (pokes, emotes, pick-up and drop), so a player's "Companion speech" and
// "Companion sounds" settings (companionPrefs.ts) switch them off in one place.

import { create } from "zustand";
import { companionSounds, companionSpeech } from "../companionPrefs";
import { playVoice, type Voice, type VoiceOptions } from "../companionVoice";
import type { IconName } from "../icons";

/** How long a bubble stays up, pop-in and pop-out included: a reaction's small one, and an emote's large one. */
export const BUBBLE_MS = 2200;
export const LARGE_BUBBLE_MS = 3000;
export const bubbleLife = (size: BubbleSize): number => (size === "large" ? LARGE_BUBBLE_MS : BUBBLE_MS);

/** "small": a poke or pick-up reaction. "large": an emote, a message to the table, so bigger and bolder. */
export type BubbleSize = "small" | "large";

/** What sets a large bubble apart: the emote's icon, and its colour as the fill. */
export interface BubbleBadge {
  icon: IconName;
  color: string;
}

export interface Bubble {
  /** Bumped per bubble, so a new one replaces (and re-pops) even with the same text. */
  id: number;
  text: string;
  size: BubbleSize;
  badge?: BubbleBadge;
  /** performance.now() when it appeared. */
  at: number;
}

/** The bubble over each player's companion (one each: a new one replaces the old). */
export const useBubbles = create<{ bubbles: Record<string, Bubble> }>(() => ({ bubbles: {} }));

let bubbleSeq = 1;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Shows `text` in a bubble over a player's companion for bubbleLife(size), replacing whatever it was saying.
 * Nothing while this player has companion speech turned off.
 */
export function say(playerId: string, text: string | undefined, size: BubbleSize = "small", badge?: BubbleBadge) {
  if (!text || !companionSpeech()) return;
  const bubble: Bubble = { id: bubbleSeq++, text, size, badge, at: performance.now() };
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
    }, bubbleLife(size)),
  );
}

/**
 * Where each companion's bubble points, in viewport pixels: the top of its head (x, y) and its feet (footY), as
 * drawn this frame. The 3D figure writes it (it knows the camera); the bubbles themselves are DOM
 * (SpeechBubbles.tsx), drawn over the whole table screen, HUD panels included, so a companion in a corner of the
 * screen can still be read. `on` is false while the head is behind the camera.
 */
export const bubbleAnchors = new Map<string, { x: number; y: number; footY: number; on: boolean }>();

/** Gap kept between a bubble and the edges of the window. */
export const BUBBLE_MARGIN = 8;

export interface BubblePlace {
  /** Top-left corner of the bubble's body. */
  left: number;
  top: number;
  /** Where the tail sits along the body (px from its left edge). */
  tail: number;
  /** Under the companion (its tail pointing up), when there's no room above its head. */
  below: boolean;
}

/**
 * Where a bubble `width` × `height` px (body only; its tail reaches `tailSize` further) goes for a companion whose
 * head is at (x, y) and feet at footY, in a `viewW` × `viewH` window. Above the head, slid sideways to stay
 * inside the window with the tail still on the companion; under the feet when the top of the window would cut it
 * off (a companion near the top edge); above, pinned to the top edge, if it fits neither way.
 */
export function placeBubble(at: { x: number; y: number; footY: number }, width: number, height: number, tailSize: number, viewW: number, viewH: number): BubblePlace {
  const max = viewW - width - BUBBLE_MARGIN;
  const left = max < BUBBLE_MARGIN ? (viewW - width) / 2 : Math.min(Math.max(at.x - width / 2, BUBBLE_MARGIN), max);
  // The tail keeps clear of the rounded corners.
  const tail = Math.min(Math.max(at.x - left, 22), width - 22);
  const above = at.y - tailSize - height;
  if (above >= BUBBLE_MARGIN) return { left, top: above, tail, below: false };
  const under = at.footY + tailSize;
  if (under + height <= viewH - BUBBLE_MARGIN) return { left, top: under, tail, below: true };
  return { left, top: BUBBLE_MARGIN, tail, below: false };
}

/** Takes every bubble down at once (leaving the table: the next room reuses player ids). */
export function clearBubbles() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  useBubbles.setState({ bubbles: {} });
}

/** Plays one of a companion's voice sounds at the table (see companionVoice.ts); silent while companion sounds are off. */
export function voice(companion: string, slot: string, opts: VoiceOptions = {}): Voice | null {
  return companionSounds() ? playVoice(companion, slot, opts) : null;
}

/**
 * How a bubble looks `age` ms in: it pops in (overshooting a touch), holds, then shrinks a little as it fades.
 * A large one (an emote) pops bigger, with a wobble, and stays longer. Reduced motion: no size change or
 * wobble, just the fade.
 */
export function bubblePop(age: number, still = false, size: BubbleSize = "small"): { scale: number; alpha: number; rot: number } {
  const large = size === "large";
  const life = bubbleLife(size);
  const t = Math.max(0, age);
  const inMs = large ? 260 : 160;
  const inT = Math.min(1, t / inMs);
  const outT = Math.min(1, Math.max(0, (t - (life - 220)) / 220));
  const alpha = Math.min(1, t / 90) * (1 - outT);
  if (still) return { scale: 1, alpha, rot: 0 };
  // easeOutBack: 0 → ~1.08 → 1 (large: ~1.2 → 1).
  const c = large ? 3.2 : 1.7;
  const back = 1 + (c + 1) * (inT - 1) ** 3 + c * (inT - 1) ** 2;
  // Large: a quick side-to-side wobble that settles within half a second.
  const rot = large && t < 520 ? 0.09 * Math.sin(t / 38) * (1 - t / 520) : 0;
  return { scale: Math.max(0, back) * (1 - 0.15 * outT), alpha, rot };
}
