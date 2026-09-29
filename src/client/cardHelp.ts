// Rules help for the zoomed card: which mechanics and types a card has, linked to the community MTG
// Wiki so new players can look them up in one click. Mechanics come from Scryfall's `keywords`, so
// new sets need no upkeep here; types come from the type line.

import type { CardData } from "../shared/types";
import { faceOf, hasBackFace } from "./cardStyle";

/** MTG Wiki search: an exact title redirects to its page, anything else lands on search results. */
export function rulesLookupUrl(term: string): string {
  return `https://mtg.wiki/index.php?search=${encodeURIComponent(term)}`;
}

// Card types and supertypes all have rules of their own.
const TYPE_WORDS = new Set([
  "Artifact", "Battle", "Creature", "Enchantment", "Instant", "Kindred", "Land", "Planeswalker", "Sorcery", "Tribal",
  "Basic", "Legendary", "Snow", "World", "Token",
]);

// Subtypes with rules attached. Creature and land types (Goblin, Island...) are left out: they
// don't tell a new player how the card plays.
const RULES_SUBTYPES = new Set([
  "Aura", "Background", "Cartouche", "Case", "Class", "Curse", "Equipment", "Fortification", "Role", "Room", "Rune", "Saga", "Shrine", "Vehicle", "Spacecraft",
  "Blood", "Clue", "Food", "Gold", "Incubator", "Map", "Powerstone", "Treasure", "Attraction", "Contraption",
  "Adventure", "Arcane", "Lesson", "Omen", "Trap",
  "Siege", "Planet",
]);

const LAYOUT_TERMS: Record<string, string> = {
  transform: "Double-faced card",
  modal_dfc: "Modal double-faced card",
  split: "Split card",
  flip: "Flip card",
};

/** Rules-relevant types on a type line, in printed order ("Legendary Artifact — Equipment // ..."). */
export function typeTerms(typeLine: string): string[] {
  const terms: string[] = [];
  for (const half of typeLine.split("//")) {
    const [types, subtypes = ""] = half.split("—");
    for (const w of types.trim().split(/\s+/)) if (TYPE_WORDS.has(w)) terms.push(w);
    for (const w of subtypes.trim().split(/\s+/)) if (RULES_SUBTYPES.has(w)) terms.push(w);
  }
  return [...new Set(terms)];
}

/**
 * Scryfall lists keywords for the whole card, in no particular order. Put them in the order the
 * rules text mentions them. A double-faced card shows one face at a time, so keep only the ones
 * that face mentions (Delver's front transforms, its back flies).
 */
export function keywordsForFace(card: CardData, face = 0): string[] {
  const text = faceOf(card, face).oracleText;
  const found = (card.keywords ?? []).map((k) => ({ k, at: text.search(new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|ed|ing)?\\b`, "i")) }));
  const shown = hasBackFace(card) ? found.filter((f) => f.at >= 0) : found;
  const order = (at: number) => (at < 0 ? Infinity : at);
  return shown.sort((a, b) => order(a.at) - order(b.at)).map((f) => f.k);
}

export interface CardHelpTerms {
  mechanics: string[];
  types: string[];
}

export function cardHelpTerms(card: CardData, face = 0): CardHelpTerms {
  const mechanics = keywordsForFace(card, face);
  const types = typeTerms(faceOf(card, face).typeLine).filter((t) => !mechanics.includes(t));
  const layout = LAYOUT_TERMS[card.layout];
  if (layout) types.push(layout);
  return { mechanics, types };
}
