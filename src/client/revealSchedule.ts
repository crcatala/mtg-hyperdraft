// Timeline of a fresh pack being opened: cards are dealt face down in a quick cascade, then flip
// face up in a wave (commons first). Drama is relative to the pack: only the cards that are rarer
// than the rest of it (at most the last two) get a beat of suspense and the big effects. A cube
// pack full of rares is a fast shimmering wave, not fifteen drumrolls.
// Pure so the pacing can be unit tested; the Draft screen turns it into timers.

import type { Rarity } from "../shared/types";

export const RARITY_RANK: Record<Rarity, number> = { mythic: 4, special: 3, rare: 2, uncommon: 1, common: 0 };

/** How long the booster takes to tear open before cards are dealt (matches the CSS). */
export const TEAR_MS = 320;
/** How long a card's reveal effects (flip arc, glint, rarity ring, sparks) keep playing. */
export const REVEAL_FX_MS = 1000;

const DEAL_STAGGER_MS = 16;
/** Reveals start while the last cards are still landing. */
const DEAL_TAIL_MS = 140;
/** Wave spacing by rank (common, uncommon, rare, special, mythic). */
const WAVE_GAP_MS = [36, 44, 50, 56, 56];
const HIGHLIGHT_SUSPENSE_MS = { rare: 130, mythic: 180 };
const HIGHLIGHT_GAP_MS = { rare: 110, mythic: 120 };
const MAX_HIGHLIGHTS = 2;
const SETTLE_MS = 200;

export interface RevealStep {
  /** Index into the reveal order (0 = first card flipped). */
  k: number;
  at: number;
  rank: number;
  /** A standout card for this pack: suspense beat, flash, sparks and a fanfare. */
  highlight: boolean;
}

export interface RevealSchedule {
  /** When each card is dealt (sound cue), in ms after dealing starts. */
  deals: number[];
  reveals: RevealStep[];
  /** When the pack becomes interactive; effects of the last cards may still be finishing. */
  done: number;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

/** `ranks` are the RARITY_RANKs of the cards in reveal order (rarest last). */
export function revealSchedule(ranks: number[]): RevealSchedule {
  const n = ranks.length;
  const typical = median(ranks);
  const highlight = ranks.map((rank, k) => k >= n - MAX_HIGHLIGHTS && rank >= RARITY_RANK.rare && rank > typical);
  const deals = ranks.map((_, i) => i * DEAL_STAGGER_MS);
  let t = n * DEAL_STAGGER_MS + DEAL_TAIL_MS;
  const reveals: RevealStep[] = [];
  ranks.forEach((rank, k) => {
    const big = rank > RARITY_RANK.rare;
    if (highlight[k]) t += big ? HIGHLIGHT_SUSPENSE_MS.mythic : HIGHLIGHT_SUSPENSE_MS.rare;
    reveals.push({ k, at: t, rank, highlight: highlight[k] });
    t += highlight[k] ? (big ? HIGHLIGHT_GAP_MS.mythic : HIGHLIGHT_GAP_MS.rare) : WAVE_GAP_MS[Math.min(rank, WAVE_GAP_MS.length - 1)];
  });
  return { deals, reveals, done: t + SETTLE_MS };
}
