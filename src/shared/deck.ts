// Deckbuilding helpers: counts, basic-land suggestions and one-click auto-build.

import type { BasicCounts, BasicLand, CardData, CardInstance, CardMap, Color, DeckState } from "./types";
import { COLORS } from "./types";
import { colorAffinity, isLand, pickScore } from "./autopick";

export const emptyBasics = (): BasicCounts => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });

export function newDeck(picks: string[]): DeckState {
  return { main: [], side: picks.slice(), basics: emptyBasics(), ready: false };
}

export function basicsTotal(basics: BasicCounts): number {
  return Object.values(basics).reduce((a, b) => a + b, 0);
}

export function deckSize(deck: DeckState): number {
  return deck.main.length + basicsTotal(deck.basics);
}

/** Coloured mana symbols per colour; hybrid symbols split their weight. */
export function colorPips(manaCost: string): Record<Color, number> {
  const pips: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const [, sym] of manaCost.matchAll(/\{([^}]+)\}/g)) {
    const colors = sym.split("/").filter((p): p is Color => (COLORS as string[]).includes(p));
    for (const c of colors) pips[c] += 1 / colors.length;
  }
  return pips;
}

/** Fills the deck up to `target` cards with basics in proportion to the main deck's coloured pips. */
export function suggestBasics(main: CardData[], target: number): BasicCounts {
  const basics = emptyBasics();
  const needed = Math.max(0, target - main.length);
  if (needed === 0) return basics;

  const totals: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const card of main) {
    if (isLand(card)) continue;
    const pips = colorPips(card.manaCost || card.faces?.[0]?.manaCost || "");
    for (const c of COLORS) totals[c] += pips[c];
  }
  const sum = COLORS.reduce((a, c) => a + totals[c], 0);
  if (sum === 0) {
    basics.C = needed;
    return basics;
  }

  // Largest-remainder rounding, and every colour with pips gets at least one land.
  const exact = COLORS.map((c) => ({ c, v: (totals[c] / sum) * needed }));
  let given = 0;
  for (const { c, v } of exact) {
    basics[c] = totals[c] > 0 ? Math.max(1, Math.floor(v)) : 0;
    given += basics[c];
  }
  const byRemainder = exact.filter((e) => totals[e.c] > 0).sort((a, b) => (b.v % 1) - (a.v % 1));
  for (let i = 0; given < needed; i++, given++) basics[byRemainder[i % byRemainder.length].c]++;
  while (given > needed) {
    const biggest = COLORS.reduce((a, b) => (basics[a] >= basics[b] ? a : b));
    basics[biggest]--;
    given--;
  }
  return basics;
}

/** Picks the two strongest colours and the best 23 spells in them; 17 basics make 40. */
export function autoBuild(picks: string[], instances: Record<string, CardInstance>, cards: CardMap, target = 40): DeckState {
  const pickedCards = picks.map((iid) => cards[instances[iid].cardId]);
  const colors = new Set(colorAffinity(pickedCards).slice(0, 2).map((a) => a.color));
  const spellsWanted = Math.round(target * (23 / 40));

  const ranked = picks
    .map((iid) => ({ iid, card: cards[instances[iid].cardId] }))
    .filter(({ card }) => card.colors.every((c) => colors.has(c)))
    .filter(({ card }) => !isLand(card) || card.colorIdentity.some((c) => colors.has(c)))
    .sort((a, b) => pickScore(b.card, pickedCards) - pickScore(a.card, pickedCards));

  const spells = ranked.filter(({ card }) => !isLand(card)).slice(0, spellsWanted);
  const lands = ranked.filter(({ card }) => isLand(card)).slice(0, 3);
  const main = [...spells, ...lands].map((x) => x.iid);
  const mainSet = new Set(main);
  return {
    main,
    side: picks.filter((iid) => !mainSet.has(iid)),
    basics: suggestBasics(main.map((iid) => cards[instances[iid].cardId]), target),
    ready: false,
  };
}

export function isBasicLand(key: string): key is BasicLand {
  return ["W", "U", "B", "R", "G", "C"].includes(key);
}
