// The cube's own cards, in browsing order (lobby carousel, cube browser).

import type { CardData, CardMap } from "../shared/types";
import { isLand } from "../shared/autopick";

/** White, blue, black, red, green, then multicolour, then colourless (artifacts, lands). */
function colorRank(c: CardData): number {
  if (c.colors.length === 0) return 7;
  if (c.colors.length > 1) return 6;
  return "WUBRG".indexOf(c.colors[0]);
}

/**
 * Every card in the cube, without the basic lands the import adds for deckbuilding (`basicIds`),
 * sorted like a binder: colour, then spells before lands, then mana value, then name.
 */
export function cubeCards(cards: CardMap, basicIds: Partial<Record<string, string>> = {}): CardData[] {
  const added = new Set(Object.values(basicIds));
  return Object.values(cards)
    .filter((c) => !c.basic && !added.has(c.id))
    .sort((a, b) => colorRank(a) - colorRank(b) || Number(isLand(a)) - Number(isLand(b)) || a.cmc - b.cmc || a.name.localeCompare(b.name));
}

/** Case- and accent-insensitive name filter. */
export function matchesName(card: CardData, query: string): boolean {
  const q = fold(query.trim());
  return !q || fold(card.name).includes(q);
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
