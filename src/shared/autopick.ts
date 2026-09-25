// Card evaluation for bots, timed-out picks and the deckbuilder's auto-build.
// Heuristic: CubeCobra rating (if known) + rarity, nudged toward colours the drafter is already in.

import type { CardData, Color, Rarity } from "./types";
import { COLORS } from "./types";
import type { Rng } from "./rng";

const RARITY_WEIGHT: Record<Rarity, number> = { common: 0, uncommon: 0.15, rare: 0.3, mythic: 0.4, special: 0.3 };

export function baseScore(card: CardData): number {
  const rarity = RARITY_WEIGHT[card.rarity];
  if (card.elo === undefined) return rarity;
  return (card.elo - 1200) / 300 + rarity * 0.5;
}

export function isLand(card: CardData): boolean {
  return /\bLand\b/.test(card.typeLine.split("//")[0]);
}

/** Weighted colour commitment of a pile of picks, strongest first. */
export function colorAffinity(picked: CardData[]): { color: Color; weight: number }[] {
  const weight: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const card of picked) {
    const s = Math.max(0.2, baseScore(card) + 1);
    for (const c of card.colors) weight[c] += s / card.colors.length;
  }
  return COLORS.map((color) => ({ color, weight: weight[color] })).sort((a, b) => b.weight - a.weight);
}

export function pickScore(card: CardData, picked: CardData[], affinity = colorAffinity(picked)): number {
  const base = baseScore(card);
  // Commitment ramps up over the first ~12 picks; early picks are taken on raw power.
  const commitment = Math.min(1, picked.length / 12);
  if (commitment === 0 || card.colors.length === 0) return base + (card.colors.length === 0 ? 0.1 * commitment : 0);
  const main = new Set(affinity.slice(0, 2).map((a) => a.color));
  const offColors = card.colors.filter((c) => !main.has(c)).length;
  const fit = offColors === 0 ? 0.5 : -0.35 * offColors;
  return base + fit * commitment;
}

export function rankCards(candidates: CardData[], picked: CardData[], rng?: Rng): CardData[] {
  const affinity = colorAffinity(picked);
  const scored = candidates.map((card) => ({ card, score: pickScore(card, picked, affinity) + (rng ? rng() * 0.05 : 0) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.card);
}
